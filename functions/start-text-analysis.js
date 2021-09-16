const aws = require('aws-sdk')

const { INPUT_BUCKET_URL } = process.env

const transcribeservice = new aws.TranscribeService();

module.exports.handler = async (event) => {

  console.log(event)

  console.log(transactionId)
  console.log(inputObjectId)
  console.log(INPUT_BUCKET_URL)

  const transactionId = event.transactionId
  const inputObjectId = event.inputObjectId

  var params = {
    Media: { 
      MediaFileUri: `${INPUT_BUCKET_URL}/${inputObjectId}`
    },
    TranscriptionJobName: transactionId,
    LanguageCode: "pt-BR"
  }

  await transcribeservice.startTranscriptionJob(params, (err) => {
    if (err) 
      throw Error(`err while executing step function ${err.stack}`)
  }).promise()

  return event
}