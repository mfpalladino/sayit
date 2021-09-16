// Based on http://pythonhackers.com/p/fluent-ffmpeg/node-fluent-ffmpeg
// and https://trac.ffmpeg.org/wiki/Create%20a%20mosaic%20out%20of%20several%20input%20videos
// and https://stackoverflow.com/questions/61848540/adding-background-music-using-fluent-ffmpeg

'use strict';

const   aws = require('aws-sdk'),
	    fs = require('fs'),
	    s3 = new aws.S3(),
        ddb = new aws.DynamoDB({apiVersion: '2012-08-10'});
        ffmpegPath = require('@ffmpeg-installer/ffmpeg').path,
        ffmpeg = require('fluent-ffmpeg'),
        TO_MERGE_TABLE = process.env.TO_MERGE_TABLE,
        VIDEO_COUNT_TO_MERGE = process.env.VIDEO_COUNT_TO_MERGE;

exports.handler = async (event, context) => {

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
                  N: 0
                 }
               }, 
            KeyConditionExpression: "isMerged = :v1", 
        };

        ddb.query(params, function(err, data){
            if (err) console.log(err, err.stack); // an error occurred
            else     console.log(data);           // successful response
        });
    };

    const updateItem = (ids) => {

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

        dynamodb.transactWriteItems(params, function(err, data) {
            if (err) console.log(err, err.stack);
            else     console.log(data);
        });
    };

    var itemsToMerge = getItemsToMerge();

    if(itemsToMerge.Count < VIDEO_COUNT_TO_MERGE)
        return;
    
    //baixar itens do S3

    //chamar createMosaic

    //atualizar no dynamo

    //subir no outro s3

};