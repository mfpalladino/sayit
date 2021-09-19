const aws = require("aws-sdk")

const { INPUT_BUCKET_URL } = process.env

const transcribeService = new aws.TranscribeService()

module.exports.handler = async (event) => {
  console.log(event)

  const transactionId = event.transactionId
  const inputObjectId = event.inputObjectId
  const url = `${INPUT_BUCKET_URL}${inputObjectId}`

  var params = {
    Media: {
      MediaFileUri: url,
    },
    TranscriptionJobName: transactionId,
    LanguageCode: "pt-BR",
  }

  event.states = {
    startTextAnalysis: {
      result: false,
    },
  }

  await transcribeService
    .startTranscriptionJob(params, (err) => {
      if (!err) event.states.startTextAnalysis.result = true
    })
    .promise()

  return event
}
