const { Client, PrivateKey } = require("@hiveio/dhive");
var utils = require('./utils');
var config = require('./config.js');

const operations = [];

(async () => {
  try {
    var rpc_node = config.rpc_nodes[0];
    dsteem = new Client(rpc_node, {rebrandedApi: true});
    var privKey = config.active_key_pay;
    var response = await dsteem.broadcast.sendOperations( operations , PrivateKey.fromString(privKey) )
    utils.log('Transaction sent successfully with '+operations.length+' operations. Block:'+response.block_num+' tx:'+response.id)
  } catch(error) {
    utils.log('Error broadcasting operations. Reason:')
    utils.log(error)
  }
  process.exit(1);
})()