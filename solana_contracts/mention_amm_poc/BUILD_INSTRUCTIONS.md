# Build Instructions for mention_amm_poc

## Issue

The project uses Anchor 0.32.1, which has a known bug with the IDL build process when used with certain Rust versions. The error manifests as:

```
error[E0599]: no method named `local_file` found for struct `proc_macro::Span`
```

This is caused by a compatibility issue between `anchor-syn 0.32.1` and newer versions of the `proc-macro2` crate.

## Solution

The project is configured to use **Rust 1.72.0** (via `rust-toolchain.toml`) and builds **without IDL generation**.

### Prerequisites

1. **Solana CLI** must be in your PATH:
   ```bash
   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
   ```
   
   This has been added to your `~/.zshrc`, so it will be available in new terminal sessions.

2. **Rust 1.72.0** will be automatically installed when you build (via `rust-toolchain.toml`)

### Building the Project

**Option 1: Build without IDL (recommended)**
```bash
anchor clean
anchor build --no-idl
```

**Option 2: Use the build script**
```bash
./build.sh
```

### Output

The successful build will create:
- `target/deploy/mention_amm_poc.so` - The compiled Solana program
- `target/deploy/mention_amm_poc-keypair.json` - The program keypair

## Future Fix

To enable IDL generation in the future, you can:

1. **Upgrade to Anchor 0.31.1** (which has the fix, but is older)
2. **Wait for Anchor 0.33.x** which should fix this issue
3. **Manually generate the IDL** if needed for your frontend

## Dependencies

- Anchor: 0.32.1
- Anchor SPL: 0.32.1
- Rust: 1.72.0 (pinned via rust-toolchain.toml)
- Solana CLI: 3.0.13

## Notes

- The program compiles successfully; only the IDL generation step fails
- All program functionality is intact
- The `idl-build` feature has been properly configured in `Cargo.toml`

