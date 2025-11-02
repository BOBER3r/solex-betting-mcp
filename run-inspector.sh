#!/bin/bash

# Load environment variables from .env
export $(cat .env | grep -v '^#' | xargs)

# Run MCP Inspector with environment variables pre-loaded
npx @modelcontextprotocol/inspector node dist/index.js
