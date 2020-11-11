require("dotenv").config();

const steemKeys = {
  account: process.env.ACCOUNT,
  accountpay: process.env.ACCOUNT_PAY,
  memo_key: '',
  posting_key: '',
  active_key: process.env.ACTIVE_KEY,
  active_key_pay: process.env.ACTIVE_KEY_PAY,
  owner_account: 'ocd',
  fund_account: 'ocdbfund'
};
const firebaseCredentials = JSON.parse(Buffer.from(process.env.FIREBASE_CREDENTIALS, "base64").toString("utf8"));

const backup_mode = false
const disabled_mode = false
const detailed_logging = false
const auto_claim_rewards =  true
const post_rewards_withdrawal_account =  ''
const min_bid =  0.1
const max_bid =  999
const batch_vote_weight =  100
const min_post_age =  0
const max_post_age =  72
const allow_comments = process.env.ALLOW_COMMENTS==='true' ? true : false
const currencies_accepted =  ["HBD", "HIVE"]
const refunds_enabled =  true
const min_refund_amount =  0.002
const no_refund =  ["bittrex", "poloniex", "openledger", "blocktrades", "minnowbooster", "ginabot", "muliadimacro", "muksalmacro"]
const comment_location =  'comment.md'
const max_per_author_per_round =  1

const blacklist_settings = {
  flag_signal_accounts: ["spaminator", "cheetah", "steemcleaners", "mack-bot"],
  blacklist_location: "blacklist",
  shared_blacklist_location: "",
  whitelist_location: "whitelist",
  whitelist_only: true,
  refund_blacklist: false,
  blacklist_donation_account: "steemcleaners",
  blacklisted_tags: ["nsfw"]
}

const auto_withdrawal = {
  active: true,
  accounts: [
    {
      "name": "$delegators",
      "stake": 10000,
      "overrides": [
        { "name": "delegator_account", "beneficiary": "beneficiary_account" }
      ]
    }
  ],
  frequency: "daily",
  execute_time: 20,
  memo: "Daily Earnings - {balance} | Thank you!"
}

const api= {
  enabled: true,
  port: 3000
}

const transfer_memos = {
  bot_disabled:            "Refund - OCDB is manually curating now! For more into [check out this post](https://steemit.com/ocd/@ocd/ocdb-goes-manual)",
  below_min_bid:           "Refund for invalid bid: {amount} - Min bid amount is {min_bid}.",
  above_max_bid:           "Refund for invalid bid: {amount} - Max bid amount is {max_bid}.",
  invalid_currency:        "Refund for invalid bid: {amount} - Bids in {currency} are not accepted.",
  no_comments:             "Refund for invalid bid: {amount} - Bids not allowed on comments.",
  already_voted:           "Refund for invalid bid: {amount} - Bot already voted on this post.",
  max_age:                 "Refund for invalid bid: {amount} - Posts cannot be older than {max_age}.",
  min_age:                 "Your bid has been added to the following round since the post is less than {min_age} minutes old.",
  invalid_post_url:        "Refund for invalid bid: {amount} - Invalid post URL in memo.",
  blacklist_refund:        "Refund for invalid bid: {amount} - The author of this post is on the blacklist.",
  blacklist_no_refund:     "Bid is invalid - The author of this post is on the blacklist.",
  blacklist_donation:      "Bid from blacklisted/flagged user sent as a donation. Thank you!",
  flag_refund:             "Refund for invalid bid: {amount} - This post has been flagged by one or more spam / abuse indicator accounts.",
  flag_no_refund:          "Bid is invalid - This post has been flagged by one or more spam / abuse indicator accounts.",
  blacklist_tag:           "Bid is invalid - This post contains the [{tag}] tag which is not allowed by this bot.",
  bids_per_round:          "Bid is invalid - This author already has the maximum number of allowed bids in this round.",
  bids_per_day:            "Bid is invalid - Only bids of the same author are accepted every {bids_per_day} hours.",
  round_full:              "The current bidding round is full. Your bid has been submitted into the following round.",
  forward_payment:         "Payment forwarded from @{tag}.",
  whitelist_only:          "Bid is invalid - Only posts by whitelisted authors are accepted by this bot."
}

const rpc_nodes = [
  "https://api.hive.blog"
]

module.exports = {
  // steemKeys
  ...steemKeys,
  firebaseCredentials,

  // config
  rpc_nodes,
  backup_mode,
  disabled_mode,
  detailed_logging,
  auto_claim_rewards,
  post_rewards_withdrawal_account,
  min_bid,
  max_bid,
  batch_vote_weight,
  min_post_age,
  max_post_age,
  allow_comments,
  currencies_accepted,
  refunds_enabled,
  min_refund_amount,
  no_refund,
  comment_location,
  max_per_author_per_round,
  blacklist_settings,
  auto_withdrawal,
  api,
  transfer_memos,
}
