const aws = require('aws-sdk')
const fetch = require('node-fetch')

const transcribeservice = new aws.TranscribeService();

module.exports.handler = async (event) => {

  const transactionId = event.transactionId

  var params = {
    TranscriptionJobName: transactionId
  };

  const getTranscriptionJobResult = await transcribeservice.getTranscriptionJob(params, (err) => {
    if (err) 
      throw Error(`err while executing step function ${err.stack}`)
  }).promise()

  if (getTranscriptionJobResult.TranscriptionJob.TranscriptionJobStatus === "COMPLETED") {

    const response = await fetch(getTranscriptionJobResult.TranscriptionJob.Transcript.TranscriptFileUri)
    const getTranscriptionJobResultTranscript = await response.json()

    let firstPronunciationTime = -1
    let lastPronunciationTime = -1

    console.log(getTranscriptionJobResultTranscript) 

    getTranscriptionJobResultTranscript.results.items.forEach((item) => {
      if (item.type === "pronunciation")
      {
        if (firstPronunciationTime === -1 && item.start_time)
          firstPronunciationTime = item.start_time
        
        if (item.end_time)
          lastPronunciationTime = item.end_time
      }
    })

    event.cutStartTime = firstPronunciationTime * 1000
    event.cutDurationTime = lastPronunciationTime * 1000
  }

  return event
}