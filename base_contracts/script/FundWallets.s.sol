// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

interface IMockUSDC {
    function mint(address to, uint256 amount) external;
    function fundDemoWallets(address[] calldata wallets, uint256 amount) external;
}

/**
 * @title FundWallets
 * @notice Helper script to fund demo wallets with MockUSDC
 */
contract FundWallets is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);

        IMockUSDC usdc = IMockUSDC(usdcAddress);
        
        // Example: Fund a single wallet
        address wallet = 0x1234567890123456789012345678901234567890; // Replace with actual address
        usdc.mint(wallet, 10000 * 1e6); // 10,000 USDC
        
        console.log("Funded wallet:", wallet);
        console.log("Amount: 10,000 mUSDC");

        vm.stopBroadcast();
    }

    function fundMultiple() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        
        vm.startBroadcast(deployerPrivateKey);

        IMockUSDC usdc = IMockUSDC(usdcAddress);
        
        // Example: Fund multiple wallets
        address[] memory wallets = new address[](3);
        wallets[0] = 0x1234567890123456789012345678901234567890; // Replace
        wallets[1] = 0x2345678901234567890123456789012345678901; // Replace
        wallets[2] = 0x3456789012345678901234567890123456789012; // Replace
        
        uint256 amount = 10000 * 1e6; // 10,000 USDC each
        usdc.fundDemoWallets(wallets, amount);
        
        console.log("Funded wallets:", wallets.length);
        console.log("Amount per wallet:", amount / 1e6, "mUSDC");

        vm.stopBroadcast();
    }
}

