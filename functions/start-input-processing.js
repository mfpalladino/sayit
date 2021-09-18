const aws = require("aws-sdk")
const { v4: uuidv4 } = require("uuid")

const { INPUT_PROCESSING_STATE_MACHINE_ARN } = process.env

const stepfunctions = new aws.StepFunctions()

module.exports.handler = async (event, context) => {
  const inputObjectId = event.Records[0].s3.object.key
  const transactionId = uuidv4()

  const input = {
    inputObjectId,
    transactionId,
  }

  const params = {
    stateMachineArn: INPUT_PROCESSING_STATE_MACHINE_ARN,
    name: transactionId,
    input: JSON.stringify(input),
  }

  await stepfunctions
    .startExecution(params, (err) => {
      if (err) {
        throw Error(`err while executing step function ${err.stack}`)
      }
    })
    .promise()
}
