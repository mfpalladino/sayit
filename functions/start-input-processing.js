const aws = require('aws-sdk')

const { INPUT_PROCESSING_STATE_MACHINE_ARN } = process.env

const stepfunctions = new aws.StepFunctions()

module.exports.handler = async (event, context) => {

  const inputObjectId = event.Records[0].s3.object.key
  const transactionId = context.awsRequestId

  const input = {
    inputObjectId,
    transactionId: inputObjectId
  }
  
  const params = {
    stateMachineArn: INPUT_PROCESSING_STATE_MACHINE_ARN,
    name: transactionId,
    input: JSON.stringify(input)
  }
  
  await stepfunctions.startExecution(params, (err) => {
    if (err) {
      throw Error(`err while executing step function ${err.stack}`)
    }
  }).promise()
}