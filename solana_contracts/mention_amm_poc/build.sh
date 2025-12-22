#!/bin/bash

# Build script for mention_amm_poc Anchor program
# This script ensures Solana tools are in PATH and builds without IDL

# Add Solana to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Verify solana is available
if ! command -v solana &> /dev/null; then
    echo "Error: Solana CLI not found in PATH"
    echo "Please install Solana: https://docs.solana.com/cli/install-solana-cli-tools"
    exit 1
fi

echo "Using Solana CLI: $(solana --version)"
echo "Using Rust: $(rustc --version)"
echo ""

# Build without IDL (due to Anchor 0.32.1 IDL build bug)
echo "Building Anchor program (without IDL)..."
anchor build --no-idl

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "Output files:"
    ls -lh target/deploy/mention_amm_poc.so
    ls -lh target/deploy/mention_amm_poc-keypair.json
else
    echo ""
    echo "❌ Build failed"
    exit 1
fi

