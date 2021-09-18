const aws = require("aws-sdk")
const fs = require("fs")
const path = require("path")
const os = require("os")
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path
const ffmpeg = require("fluent-ffmpeg")

const TO_MERGE_TABLE_NAME = process.env.TO_MERGE_TABLE_NAME
const VIDEO_COUNT_TO_MERGE = process.env.VIDEO_COUNT_TO_MERGE
const TO_MERGE_BUCKET_NAME = process.env.TO_MERGE_BUCKET_NAME
const TO_PUBLISH_BUCKET_NAME = process.env.TO_PUBLISH_BUCKET_NAME

const s3 = new aws.S3()
const ddb = new aws.DynamoDB()
const workdir = os.tmpdir()

const downloadFileFromS3 = (bucket, fileKey, filePath) => {
  console.log("downloading", bucket, fileKey, filePath)
  return new Promise(function (resolve, reject) {
    const file = fs.createWriteStream(filePath),
      stream = s3
        .getObject({
          Bucket: bucket,
          Key: fileKey,
        })
        .createReadStream()
    stream.on("error", reject)
    file.on("error", reject)
    file.on("finish", function () {
      console.log("downloaded", bucket, fileKey)
      resolve(filePath)
    })
    stream.pipe(file)
  })
}

const uploadFileToS3 = (bucket, fileKey, filePath, contentType) => {
  console.log("uploading", bucket, fileKey, filePath)
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

const createMosaic = (inputFiles, outputFile) => {
  ffmpeg.setFfmpegPath(ffmpegPath)
  let command = ffmpeg()

  // Change this to the desired output resolution
  let videoWidth = 640,
    videoHeight = 480

  let videoInfo = []

  // Parse input files
  inputFiles.forEach(function (val, index, array) {
    let filename = val
    console.log(index + ": Input File ... " + filename)

    videoInfo.push({
      filename: filename,
    })
    command = command.addInput(filename)
  })

  const rows = 5
  const columns = 5

  for (let i = 0; i < inputFiles.length; i++) {
    let currentRow = Math.floor(i / columns)
    let x = ((i - columns * currentRow) * videoWidth) / columns
    let y = (currentRow * videoHeight) / rows

    videoInfo[i].coord = { x, y }
  }

  let complexFilter = []
  complexFilter.push("nullsrc=size=" + videoWidth + "x" + videoHeight + " [base0]")

  // Scale each video
  videoInfo.forEach(function (val, index, array) {
    complexFilter.push({
      filter: "setpts=PTS-STARTPTS, scale",
      options: [videoWidth / columns, videoHeight / rows],
      inputs: index + ":v",
      outputs: "block" + index,
    })
  })

  // Build Mosaic, block by block
  videoInfo.forEach(function (val, index, array) {
    complexFilter.push({
      filter: "overlay",
      options: { shortest: 1, x: val.coord.x, y: val.coord.y },
      inputs: ["base" + index, "block" + index],
      outputs: "base" + (index + 1),
    })
  })

  //add sound
  complexFilter.push({
    filter: "amix",
    options: { inputs: videoInfo.length, duration: "longest" },
  })

  return new Promise(function (resolve, reject) {
    console.log(JSON.stringify(complexFilter))
    command
      .complexFilter(complexFilter, "base25") //TODO:
      .save(outputFile)
      .on("error", function (err) {
        console.log("An error occurred: " + err.message)
        reject(err)
      })
      .on("progress", function (progress) {
        console.log("... frames: " + progress.frames)
      })
      .on("end", function () {
        console.log("Finished processing")
        resolve()
      })
  })
}

const getItemsToMerge = () => {
  let params = {
    IndexName: "byIsMerged",
    TableName: TO_MERGE_TABLE_NAME,
    ExpressionAttributeValues: {
      ":v1": {
        N: "0",
      },
    },
    KeyConditionExpression: "isMerged = :v1",
  }

  return ddb.query(params).promise()
}

const updateItems = (ids) => {
  let transactItems = []

  ids.forEach(function (val, index, array) {
    transactItems.push({
      Update: {
        TableName: TO_MERGE_TABLE_NAME,
        Key: { id: { S: val } },
        UpdateExpression: "SET #IsMerged = :true",
        ExpressionAttributeNames: {
          "#IsMerged": "isMerged",
        },
        ExpressionAttributeValues: {
          ":true": {
            N: "1",
          },
        },
      },
    })
  })

  let params = {
    TransactItems: transactItems,
  }

  return ddb.transactWriteItems(params).promise()
}

exports.handler = async (event, context) => {
  let itemsToMerge = await getItemsToMerge()

  if (itemsToMerge.Count < VIDEO_COUNT_TO_MERGE) {
    console.log("There is no enough videos to start the merge operation")
    return
  }

  let inputFilesToMosaic = []
  let idsToUpdate = []

  for (const item of itemsToMerge.Items.slice(0, VIDEO_COUNT_TO_MERGE)) {
    const itemId = item.id.S
    let filePath = path.join(workdir, itemId)
    try {
      await downloadFileFromS3(TO_MERGE_BUCKET_NAME, itemId, filePath)
      inputFilesToMosaic.push(filePath)
      idsToUpdate.push(itemId)
    } catch (err) {
      console.log("An error occurred: " + err.message)
    }
  }

  const outputFileKey = context.awsRequestId + ".mp4"
  const outputFile = path.join(workdir, outputFileKey)
  await createMosaic(inputFilesToMosaic, outputFile)

  await uploadFileToS3(TO_PUBLISH_BUCKET_NAME, outputFileKey, outputFile)

  await updateItems(idsToUpdate)

  console.log("finished")
}