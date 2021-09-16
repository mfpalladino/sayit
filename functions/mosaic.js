// Based on http://pythonhackers.com/p/fluent-ffmpeg/node-fluent-ffmpeg
// and https://trac.ffmpeg.org/wiki/Create%20a%20mosaic%20out%20of%20several%20input%20videos
// and https://stackoverflow.com/questions/61848540/adding-background-music-using-fluent-ffmpeg

'use strict';

const   aws = require('aws-sdk'),
	    s3 = new aws.S3(),
        ddb = new aws.DynamoDB();

const   fs = require('fs'),
        path = require('path'),
        os = require('os');

const   ffmpegPath = require('@ffmpeg-installer/ffmpeg').path,
        ffmpeg = require('fluent-ffmpeg');
        
const   TO_MERGE_TABLE = "sayit-backend-dev-VideosToMergeTable-9OD70OQ11B8B",//process.env.TO_MERGE_TABLE,
        VIDEO_COUNT_TO_MERGE = 4,//process.env.VIDEO_COUNT_TO_MERGE,
        TO_MERGE_BUCKET = "sayit.tomerge.dev",//process.env.TO_MERGE_BUCKET,
        TO_PUBLISH_BUCKET = "sayit.topublish.dev";//process.env.TO_PUBLISH_BUCKET;

const   workdir = os.tmpdir();
const { 
    v4: uuidv4,
  } = require('uuid');

  const downloadFileFromS3 = (bucket, fileKey, filePath) => {
    console.log('downloading', bucket, fileKey, filePath);
    return new Promise(function (resolve, reject) {
        const file = fs.createWriteStream(filePath),
            stream = s3.getObject({
                Bucket: bucket,
                Key: fileKey
            }).createReadStream();
        stream.on('error', reject);
        file.on('error', reject);
        file.on('finish', function () {
            console.log('downloaded', bucket, fileKey);
            resolve(filePath);
        });
        stream.pipe(file);
    });
};

const uploadFileToS3 = (bucket, fileKey, filePath, contentType) => {
    console.log('uploading', bucket, fileKey, filePath);
    return s3.upload({
        Bucket: bucket,
        Key: fileKey,
        Body: fs.createReadStream(filePath),
        ACL: 'private',
        ContentType: contentType
    }).promise();
};

const createMosaic = (inputFiles, outputFile) => {

    ffmpeg.setFfmpegPath(ffmpegPath);
    var command = ffmpeg();

    // Change this to the desired output resolution  
    var x=640, y=480;

    var videoInfo = [];

    // Parse arguments
    // var args = process.argv.slice(2);
    inputFiles.forEach(function (val, index, array) {
        var filename = val;
        console.log(index + ': Input File ... ' + filename);
        
        videoInfo.push({			
            filename: filename
        });
        command = command.addInput(filename);
    });	

    //TODO: montar um algoritmo mais dinâmico, caso tenha +/- que 4 vídeos
    videoInfo[0].coord = { x: 0, y: 0 };
    videoInfo[1].coord = { x: x/2, y: 0 };
    videoInfo[2].coord = { x: 0, y: y/2 };
    videoInfo[3].coord = { x: x/2, y: y/2 };

    var complexFilter = [];
    complexFilter.push('nullsrc=size=' + x + 'x' + y + ' [base0]');

    // Scale each video
    videoInfo.forEach(function (val, index, array) {
        complexFilter.push({
            filter: 'setpts=PTS-STARTPTS, scale', options: [x/2, y/2], //TODO: melhorar scale caso tenha +/- que 4 vídeos
            inputs: index+':v', outputs: 'block'+index
        });
    });

    // Build Mosaic, block by block
    videoInfo.forEach(function (val, index, array) {
        complexFilter.push({
            filter: 'overlay', options: { shortest:1, x: val.coord.x, y: val.coord.y },
            inputs: ['base'+index, 'block'+index], outputs: 'base'+(index+1)
        });
    });

    //add sound
    complexFilter.push({
        filter: 'amix', options: { inputs: videoInfo.length, duration: 'shortest' }
    })

    //var outFile = 'out.mp4';

    return new Promise(function (resolve, reject) {
        command
            .complexFilter(complexFilter, 'base4')
            .save(outputFile)
            .on('error', function(err) {
                console.log('An error occurred: ' + err.message);
                reject(err);
            })	
            .on('progress', function(progress) { 
                console.log('... frames: ' + progress.frames);
            })
            .on('end', function() { 
                console.log('Finished processing'); 
                resolve();
            });
    });
};

const getItemsToMerge = () => {

    var params = {
        IndexName: 'byIsMerged',
        TableName: TO_MERGE_TABLE,
        ExpressionAttributeValues: {
            ":v1": {
              N: '0'
             }
           }, 
        KeyConditionExpression: "isMerged = :v1", 
    };

    return new Promise(function (resolve, reject) {
        ddb.query(params, function(err, data) {
            if(err){
                console.log('An error occurred: ' + err.message);
                reject();
            }
            else{
                resolve(data);
            }
        });
    });
};

const updateItems = (ids) => {

    var transactItems = [];

    ids.forEach(function (val, index, array) {
        transactItems.push({
            Update: {
                TableName: TO_MERGE_TABLE,
                Key: { id: { S: val } },
                //ConditionExpression: 'isMerged = 0',
                UpdateExpression: 'set isMerged = 1'
            }
        });
    });

    var params = {
        TransactItems: transactItems
    };

    return ddb.transactWriteItems(params).promise();
};

exports.handler = async (event, context) => {

    try{
        var itemsToMerge = await getItemsToMerge();

        if(itemsToMerge.Count < VIDEO_COUNT_TO_MERGE){
            console.log("Ainda não há itens suficientes para fazer o merge");
            return;
        }
        
        var inputFilesToMosaic = [];
        var idsToUpdate = [];

        //baixar itens do S3
        itemsToMerge.Items.forEach(async function (val, index, array) {

            if(index > 3) //TODO: gambiarra pra só deixar passar adiante 4 vídeos
                return;

            var filePath = path.join(workdir, val);
            try{
                await downloadFileFromS3(TO_MERGE_BUCKET, val.Id, filePath);
                inputFilesToMosaic.push(filePath);
                idsToUpdate.push(val.Id);
            } catch(err){
                console.log('An error occurred: ' + err.message);
            }
        });

        //criar mosaico
        const outputFileKey = uuidv4();
        const outputFile = path.join(workdir, outputFileKey);
        await createMosaic(inputFilesToMosaic, outputFile);

        //atualizar no dynamo
        await updateItems(idsToUpdate);

        //subir no outro s3
        await uploadFileToS3(TO_PUBLISH_BUCKET, outputFileKey, outputFile);
    } catch(err){
        console.log('An error occurred: ' + err.message);
    }
};

(async () => {
    try{
        await exports.handler(null, null);
    } catch(err){
        console.log('An error occurred: ' + err.message);
    }
})();