// logger.js - Centralized logger utility for the application

// Import winston's logger creation, formatting, and transport utilities
const { createLogger, format, transports } = require('winston');

// Create a logger instance with configuration
const logger = createLogger({
  level: 'info', // Set default log level to 'info'
  format: format.combine(
    format.timestamp(), // Add timestamp to each log message
    format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`) // Custom log format
  ),
  transports: [
    new transports.Console(), // Output logs to the console
    // Add file transport below if you want to also log to a file
    // new transports.File({ filename: 'app.log' })
  ],
});

// Export the logger instance for use throughout the application
module.exports = logger;
