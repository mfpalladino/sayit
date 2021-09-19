const aws = require("aws-sdk")
const fetch = require("node-fetch")

const transcribeService = new aws.TranscribeService()

module.exports.handler = async (event) => {
  const transactionId = event.transactionId

  var params = {
    TranscriptionJobName: transactionId,
  }

  event.states.getTextAnalysisResult = {
    result = false
  }  

  const getTranscriptionJobResult = await transcribeService
    .getTranscriptionJob(params, (err) => {
      if (!err) 
        event.states.getTextAnalysisResult.result = true
    })
    .promise()

  event.states.getTextAnalysisResult.TranscriptionJobStatus = getTranscriptionJobResult.TranscriptionJob.TranscriptionJobStatus

  if (
    event.states.getTextAnalysisResult.result &&
    getTranscriptionJobResult.TranscriptionJob.TranscriptionJobStatus ===
      "COMPLETED"
  ) {
    const getTranscriptionJobResultTranscriptResult = await getTranscriptionJobResultTranscriptResult(getTranscriptionJobResult)

    let firstPronunciationTime = -1
    let lastPronunciationTime = -1

    getTranscriptionJobResultTranscriptResult.results.items.forEach((item) => {
      if (item.type === "pronunciation") {
        if (firstPronunciationTime === -1 && item.start_time)
          firstPronunciationTime = item.start_time

        if (item.end_time) lastPronunciationTime = item.end_time
      }
    })

    event.states.getTextAnalysisResult.cutStartTime = firstPronunciationTime * 0.6
    event.states.getTextAnalysisResult.cutDurationTime = lastPronunciationTime * 1.4
  }

  return event
}

async function getTranscriptionJobResultTranscript(getTranscriptionJobResult) {
  const response = await fetch(
    getTranscriptionJobResult.TranscriptionJob.Transcript.TranscriptFileUri
  )
  const getTranscriptionJobResultTranscript = await response.json()
  return getTranscriptionJobResultTranscript
}

