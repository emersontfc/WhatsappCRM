// Optimized WhatsApp connection settings for Render

private maxReconnectAttempts = 10;

// Socket configuration parameters
private socketConfig = {
    connectTimeoutMs: 180000,
    defaultQueryTimeoutMs: 30000,
    keepAliveIntervalMs: 10000,
    retryRequestDelayMs: 3000,
};

// Updating delay calculation 
delay = Math.min(10000 * (attempts + 1), 60000);

// Debugging logs
console.log('Connection timeout configuration:', this.socketConfig);

// Other existing code follows...