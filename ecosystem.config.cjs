module.exports = {
  apps: [
    {
      name: "agentx-crm",
      script: "./node_modules/tsx/dist/cli.mjs",
      args: "server.ts",
      cwd: "./",
      instances: 1, // Single instance is required because Baileys keeps WebSocket sessions in memory
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      kill_timeout: 10000, // 10s timeout to allow Baileys to close sessions gracefully on restart
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      time: true
    }
  ]
};

