'use strict';

const aws 		    = require('aws-sdk'); 
const fs 	        = require("fs");
const s3 		    = new aws.S3();
const ffmpeg        = require('fluent-ffmpeg');
const pathToFfmpeg  = require('@ffmpeg-installer/ffmpeg').path;
const path          = require('path');
const os            = require('os');

const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET;

exports.handler = function (event, context) {
    const downloadFileFromS3  = (bucket, fileKey, filePath) => {
		console.log('downloading', bucket, fileKey, filePath);
		
        return new Promise((resolve, reject) => {
			const file = fs.createWriteStream(filePath);
            const stream = s3.getObject({
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

    const cutVideo = (sourcePath, outputPath, startTime, duration) => {
        console.log('start cut video');
    
        new Promise((resolve, reject) => {
            ffmpeg(sourcePath)
                .setFfmpegPath(pathToFfmpeg)
                .output(outputPath)
                .setStartTime(startTime)
                .setDuration(duration)
                .withVideoCodec('copy')
                .withAudioCodec('copy')
                .on('end', function (err) {
                    if (!err) {
                        console.log('conversion Done');
                        resolve();
                    }
                })
                .on('error', function (err) {
                    console.log('error: ', err);
                    reject(err);
                })
                .run();
        });
    };

	const eventRecord = event.Records && event.Records[0];
	const inputBucket = eventRecord.s3.bucket.name;
    const key = eventRecord.s3.object.key;

    const cutStartTime = event.cutStartTime;
    const cutEndTime = event.cutEndTime;

	const id = context.awsRequestId;
	const resultKey = key.replace(/\.[^.]+$/, 'mp4');
	const workdir = os.tmpdir();
	const inputFile = path.join(workdir,  id + path.extname(key));
	const outputFile = path.join(workdir, 'converted-' + id + 'mp4');

	console.log('cutting', inputBucket, key, 'using', inputFile);
	
    return downloadFileFromS3(inputBucket, key, inputFile)
		.then(() => cutVideo(inputFile, outputFile, cutStartTime, cutEndTime))
        // .then(() => createOnDynamo();
		.then(() => uploadFileToS3(OUTPUT_BUCKET, resultKey, outputFile, 'video/mp4'));
};