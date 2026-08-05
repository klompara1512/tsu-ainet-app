process.env.SYNC_MODE = "tables";
process.env.RUN_DAILY_TASKS = "false";
process.env.RUN_DUPLICATE_CLEANUP = "false";
require("./kfv-sync.cjs");
