/** @type {import('@cucumber/cucumber').IConfiguration} */
module.exports = {
  default: {
    paths: ["features/**/*.feature"],
    require: ["features/steps/**/*.ts"],
    requireModule: ["ts-node/register"],
    format: ["progress"],
    publishQuiet: true,
  },
};
