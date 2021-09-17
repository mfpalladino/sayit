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
        
const   TO_MERGE_TABLE_NAME = process.env.TO_MERGE_TABLE_NAME,
        VIDEO_COUNT_TO_MERGE = process.env.VIDEO_COUNT_TO_MERGE,
        TO_MERGE_BUCKET_NAME = process.env.TO_MERGE_BUCKET_NAME,
        TO_PUBLISH_BUCKET_NAME = process.env.TO_PUBLISH_BUCKET_NAME;

/*const   TO_MERGE_TABLE_NAME = "sayit-backend-dev-VideosToMergeTable-9OD70OQ11B8B",
        VIDEO_COUNT_TO_MERGE = 4,
        TO_MERGE_BUCKET_NAME = "sayit.tomerge.dev",
        TO_PUBLISH_BUCKET_NAME = "sayit.topublish.dev";*/

const   workdir = os.tmpdir();

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
    var largura=640, altura=480;

    var videoInfo = [];

    // Parse input files
    inputFiles.forEach(function (val, index, array) {
        var filename = val;
        console.log(index + ': Input File ... ' + filename);
        
        videoInfo.push({			
            filename: filename
        });
        command = command.addInput(filename);
    });	

    const linhas = 4;
    const colunas = 4;

    for(var i = 0; i < inputFiles.length; i++){

        let linha = Math.floor(i / colunas);
        let x = (i - colunas * linha) * largura / colunas;
        let y = linha * altura / linhas;

        videoInfo[i].coord = { x, y };
    }

    var complexFilter = [];
    complexFilter.push('nullsrc=size=' + largura + 'x' + altura + ' [base0]');

    // Scale each video
    videoInfo.forEach(function (val, index, array) {
        complexFilter.push({
            filter: 'setpts=PTS-STARTPTS, scale', options: [largura/colunas, altura/linhas],
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
        filter: 'amix', options: { inputs: videoInfo.length, duration: 'longest' }
    })

    return new Promise(function (resolve, reject) {
        console.log(JSON.stringify(complexFilter));
        command
            .complexFilter(complexFilter, 'base16') //TODO:
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
        TableName: TO_MERGE_TABLE_NAME,
        ExpressionAttributeValues: {
            ":v1": {
              N: '0'
             }
           }, 
        KeyConditionExpression: "isMerged = :v1", 
    };

    return ddb.query(params).promise();
};

const updateItems = (ids) => {

    var transactItems = [];

    ids.forEach(function (val, index, array) {
        transactItems.push({
            Update: {
                TableName: TO_MERGE_TABLE_NAME,
                Key: { id: { S: val } },
                UpdateExpression: 'SET #IsMerged = :true',
                ExpressionAttributeNames: {
                    '#IsMerged' : 'isMerged'
                },
                ExpressionAttributeValues: {
                    ':true' : {
                        N: '1'
                    }
                }
            }
        });
    });

    var params = {
        TransactItems: transactItems
    };

    return ddb.transactWriteItems(params).promise();
};

exports.handler = async (event, context) => {

    var itemsToMerge = await getItemsToMerge();

    if(itemsToMerge.Count < VIDEO_COUNT_TO_MERGE){
        console.log("Ainda não há itens suficientes para fazer o merge");
        return;
    }
    
    var inputFilesToMosaic = [];
    var idsToUpdate = [];

    //baixar itens do S3
    for (const item of itemsToMerge.Items.slice(0, VIDEO_COUNT_TO_MERGE)) { //TODO: gambiarra pra só deixar passar adiante 4 vídeos

        const itemId = item.id.S;
        var filePath = path.join(workdir, itemId);
        try{
            await downloadFileFromS3(TO_MERGE_BUCKET_NAME, itemId, filePath);
            inputFilesToMosaic.push(filePath);
            idsToUpdate.push(itemId);
        } catch(err){
            console.log('An error occurred: ' + err.message);
        }
    }

    //criar mosaico
    const outputFileKey = context.awsRequestId + ".mp4";
    const outputFile = path.join(workdir, outputFileKey);
    await createMosaic(inputFilesToMosaic, outputFile);

    //subir no outro s3
    await uploadFileToS3(TO_PUBLISH_BUCKET_NAME, outputFileKey, outputFile);

    //atualizar no dynamo
    await updateItems(idsToUpdate);

    console.log("finished");
};

/*
(async () => {
    try{
        //await exports.handler(null, null);
        await createMosaic([
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/0c2197b4-1173-43cf-bd5b-542f8bdb26a9.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/0da1786a-dacb-4a57-925f-2007b29a8b0a.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/1b3dadee-b806-4a61-8a22-598fc6519056.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/1c6a68079-7146-4ce3-9dd2-178cffc628d0.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/1eab677d6-1815-4117-9f7e-aee3a9623bb7.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/1ed1e632f-0c66-4129-9c68-1d81f25e0b32.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/10c2197b4-1173-43cf-bd5b-542f8bdb26a9.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/10da1786a-dacb-4a57-925f-2007b29a8b0a.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/21b3dadee-b806-4a61-8a22-598fc6519056.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/21c6a68079-7146-4ce3-9dd2-178cffc628d0.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/21eab677d6-1815-4117-9f7e-aee3a9623bb7.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/21ed1e632f-0c66-4129-9c68-1d81f25e0b32.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/210c2197b4-1173-43cf-bd5b-542f8bdb26a9.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/210da1786a-dacb-4a57-925f-2007b29a8b0a.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/308cc8a5-83ea-492d-8583-a5539542f08d.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/875f2144-40bc-48ec-aa92-e26083cf2a5a.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/1308cc8a5-83ea-492d-8583-a5539542f08d.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/1875f2144-40bc-48ec-aa92-e26083cf2a5a.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/3210c2197b4-1173-43cf-bd5b-542f8bdb26a9.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/3210da1786a-dacb-4a57-925f-2007b29a8b0a.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/21308cc8a5-83ea-492d-8583-a5539542f08d.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/21875f2144-40bc-48ec-aa92-e26083cf2a5a.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/b3dadee-b806-4a61-8a22-598fc6519056.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/c6a68079-7146-4ce3-9dd2-178cffc628d0.mp4",
            "C:/Users/GustavoCarpaneses/Downloads/Teste Final/eab677d6-1815-4117-9f7e-aee3a9623bb7.mp4"           
        ], 'C:/Users/GustavoCarpaneses/Downloads/Teste Final/out.mp4')
    } catch(err){
        console.log('An error occurred: ' + err.message);
    }
})();
*/