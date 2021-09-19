const aws = require("aws-sdk")
const fetch = require("node-fetch")

const transcribeservice = new aws.TranscribeService()

module.exports.handler = async (event) => {
  const transactionId = event.transactionId

  var params = {
    TranscriptionJobName: transactionId,
  }

  event.states.getTextAnalysis = {
    result = false
  }  

  const getTranscriptionJobResult = await transcribeservice
    .getTranscriptionJob(params, (err) => {
      if (!err) 
        event.states.getTextAnalysis.result = true
    })
    .promise()

  event.states.getTextAnalysis.TranscriptionJobStatus = getTranscriptionJobResult.TranscriptionJob.TranscriptionJobStatus

  if (
    event.states.getTextAnalysis.result &&
    getTranscriptionJobResult.TranscriptionJob.TranscriptionJobStatus ===
      "COMPLETED"
  ) {
    const response = await fetch(
      getTranscriptionJobResult.TranscriptionJob.Transcript.TranscriptFileUri
    )
    const getTranscriptionJobResultTranscript = await response.json()

    let firstPronunciationTime = -1
    let lastPronunciationTime = -1

    getTranscriptionJobResultTranscript.results.items.forEach((item) => {
      if (item.type === "pronunciation") {
        if (firstPronunciationTime === -1 && item.start_time)
          firstPronunciationTime = item.start_time

        if (item.end_time) lastPronunciationTime = item.end_time
      }
    })

    event.states.getTextAnalysis.cutStartTime = firstPronunciationTime * 0.6
    event.states.getTextAnalysis.cutDurationTime = lastPronunciationTime * 1.4
  }

  return event
}
