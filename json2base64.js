const json = require('./firebase-credentials.json');
const jsonStr = JSON.stringify(json);
console.log(Buffer.from(jsonStr, "utf8").toString("base64"));