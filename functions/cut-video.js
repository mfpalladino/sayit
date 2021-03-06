const aws = require("aws-sdk")
const fs = require("fs")
const pathToFfmpeg = require("@ffmpeg-installer/ffmpeg").path
const ffmpeg = require("fluent-ffmpeg")
const path = require("path")
const os = require("os")

const s3 = new aws.S3()
const ddb = new aws.DynamoDB()

const OUTPUT_BUCKET = process.env.TO_MERGE_BUCKET_NAME
const INPUT_BUCKET = process.env.INPUT_BUCKET_NAME
const TO_MERGE_TABLE = process.env.TO_MERGE_TABLE_NAME

const downloadFileFromS3 = (bucket, fileKey, filePath) => {
  console.log("downloading", bucket, fileKey, filePath)

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath)
    const stream = s3
      .getObject({
        Bucket: bucket,
        Key: fileKey,
      })
      .createReadStream()

    stream.on("error", (err) => {
      console.log("S3 stream error", err)
      reject(err)
    })

    file.on("error", (err) => {
      console.log("File stream error", err)
      reject(err)
    })

    file.on("finish", function () {
      console.log("Downloaded", bucket, fileKey)
      resolve(filePath)
    })
    stream.pipe(file)
  })
}

const uploadFileToS3 = (bucket, fileKey, filePath, contentType) => {
  console.log("Uploading", bucket, fileKey, filePath)

  return s3
    .upload({
      Bucket: bucket,
      Key: fileKey,
      Body: fs.createReadStream(filePath),
      ACL: "private",
      ContentType: contentType,
    })
    .promise()
}

const cutVideo = (sourcePath, outputPath, startTime, duration) => {
  console.log("Start cut video")

  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .setFfmpegPath(pathToFfmpeg)
      .output(outputPath)
      .setStartTime(startTime)
      .setDuration(duration)
      .withVideoCodec("copy")
      .withAudioCodec("copy")
      .on("end", function (err) {
        if (!err) {
          console.log("Cutting done")
          resolve()
        }
      })
      .on("error", function (err) {
        console.log("Error on cutting", err)
        reject(err)
      })
      .run()
  })
}

const putCutItem = (id) => {
  console.log("DB put item")

  let params = {
    TableName: TO_MERGE_TABLE,
    Item: {
      id: {
        S: id,
      },
      isMerged: {
        N: "0",
      },
    },
  }

  return ddb.putItem(params).promise()
}

exports.handler = async (event) => {
  const key = event.inputObjectId
  const cutStartTime = event.states.getTextAnalysisResult.cutStartTime
  const cutDurationTime = event.states.getTextAnalysisResult.cutDurationTime
  const workdir = os.tmpdir()
  const inputFile = path.join(workdir, key)
  const outputFile = path.join(workdir, "converted-" + key)

  console.log("cutting", INPUT_BUCKET, key, "using", inputFile)

  await downloadFileFromS3(INPUT_BUCKET, key, inputFile)
  await cutVideo(inputFile, outputFile, cutStartTime, cutDurationTime)
  await putCutItem(key)
  await uploadFileToS3(OUTPUT_BUCKET, key, outputFile)
}
