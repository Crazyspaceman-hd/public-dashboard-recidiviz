const { execSync } = require("child_process");

module.exports = async () => {
  // kill the test server we spawned during global setup
  if (process.platform === "win32") {
    // the server runs under a shell on Windows; kill the whole process tree,
    // otherwise the API keeps holding port 3002 after the tests finish
    execSync(`taskkill /pid ${global.TEST_SERVER.pid} /T /F`, { stdio: "ignore" });
  } else {
    global.TEST_SERVER.kill();
  }
};
