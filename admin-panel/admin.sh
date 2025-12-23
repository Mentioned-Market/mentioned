#!/bin/bash

# Helper script for managing the Prediction Market Admin Panel

set -e

ADMIN_DIR="/Users/taylorferran/Desktop/taylor/mentioned/mentioned/admin-panel"
PROGRAM_ID="F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ"

echo "🎯 Prediction Market Admin Helper"
echo "=================================="
echo ""

case "${1:-help}" in
  start)
    echo "🚀 Starting admin panel..."
    cd "$ADMIN_DIR"
    npm run dev
    ;;
    
  build)
    echo "🔨 Building admin panel..."
    cd "$ADMIN_DIR"
    npm run build
    ;;
    
  deploy)
    echo "🌐 Starting production server..."
    cd "$ADMIN_DIR"
    npm run build
    npm start
    ;;
    
  info)
    echo "📊 Program Information:"
    echo "   Program ID: $PROGRAM_ID"
    echo "   Network: Solana Devnet"
    echo "   RPC: https://api.devnet.solana.com"
    echo ""
    echo "🌐 Admin Panel: http://localhost:3001"
    echo "💰 Get Devnet SOL: https://faucet.solana.com/"
    echo ""
    echo "📖 View Deployed Program:"
    echo "   https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
    ;;
    
  example)
    echo "📝 Example: Creating 'Trump's Speech' Markets"
    echo ""
    echo "1. Open http://localhost:3001"
    echo "2. Connect your wallet (must have Devnet SOL)"
    echo "3. Create Event:"
    echo "   Event ID: $(date +%s)"
    echo ""
    echo "4. Create Markets:"
    echo "   • Word: Mexico, Fee: 100"
    echo "   • Word: Left, Fee: 100"
    echo "   • Word: Taxes, Fee: 100"
    echo ""
    echo "5. After the speech, resolve each market (YES/NO)"
    ;;
    
  *)
    echo "Usage: $0 {start|build|deploy|info|example}"
    echo ""
    echo "Commands:"
    echo "  start    - Start development server"
    echo "  build    - Build for production"
    echo "  deploy   - Build and start production server"
    echo "  info     - Show program and panel info"
    echo "  example  - Show example usage"
    ;;
esac

