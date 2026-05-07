module.exports = {
  apps: [{
    name: 'task-map',
    script: 'server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
