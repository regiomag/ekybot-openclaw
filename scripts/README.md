# 🚀 EkyBot iOS Deployment Scripts

Automated scripts for building, archiving, and uploading EkyBot iOS app to App Store Connect.

## 📋 Scripts

### `ios-deploy.sh` - Full Deployment Pipeline
Complete automation of the iOS deployment process.

**Usage:**
```bash
# Auto-increment build number and deploy
./scripts/ios-deploy.sh

# Specify build number
./scripts/ios-deploy.sh 131

# Build and archive only (skip upload)
./scripts/ios-deploy.sh 131 --skip-upload
```

**What it does:**
1. ✅ **Git Pull** - Sync repository
2. ✅ **Version Check** - Read current build number
3. ✅ **Build Increment** - Set new build number
4. ✅ **Capacitor Sync** - Update iOS project
5. ✅ **Xcode Archive** - Create .xcarchive
6. ✅ **IPA Export** - Export for App Store Connect
7. ✅ **Upload** - Submit to App Store Connect (unless --skip-upload)
8. ✅ **Git Commit** - Save changes to repository

### `ios-quick-build.sh` - Build Only (No Upload)
Quick build for testing without uploading to App Store Connect.

**Usage:**
```bash
# Auto-increment and build (no upload)
./scripts/ios-quick-build.sh

# Specify build number and build (no upload)  
./scripts/ios-quick-build.sh 131
```

## 📱 Requirements

- Xcode Command Line Tools
- Valid Apple Developer account
- Provisioning profiles configured
- Capacitor CLI installed
- Git repository access

## 🔧 Configuration

The script uses these default configurations:

- **Team ID:** 2R9GYTV857 (Michael Dusong)
- **Bundle ID:** com.ekybot.app
- **Scheme:** App
- **Configuration:** Release

## 📊 Output

### Successful Deployment
```
🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!
===================================

📱 App: EkyBot
📊 Version: 1.0.0  
🔢 Build: 131
📦 Archive: /tmp/EkyBot-v131.xcarchive
💾 IPA: /tmp/EkybotExport-v131/App.ipa (1.27M)
🚀 Status: Ready for App Store Connect
```

### Files Created
- **Archive:** `/tmp/EkyBot-v[BUILD].xcarchive`
- **IPA:** `/tmp/EkybotExport-v[BUILD]/App.ipa`
- **Logs:** Xcode build and export logs

## 🔍 Troubleshooting

### Common Issues

**1. Build Number Conflicts**
```bash
❌ New build number (130) must be greater than current (130)
```
**Solution:** Specify a higher build number or let the script auto-increment.

**2. Provisioning Profile Issues**
```bash
❌ Xcode archive failed
```
**Solution:** Check provisioning profiles in Xcode and ensure Apple Developer account is active.

**3. Git Conflicts**
```bash
❌ Git pull failed. Please resolve conflicts manually.
```
**Solution:** Resolve git conflicts manually before running the script.

### Manual Cleanup
```bash
# Remove old archives
rm -rf /tmp/EkyBot-v*.xcarchive
rm -rf /tmp/EkybotExport-v*

# Reset git changes
git checkout -- apps/web/ios/App/App.xcodeproj/project.pbxproj
git checkout -- apps/web/ios/App/App/Info.plist
```

## 🎯 Best Practices

1. **Always test locally** before deploying to App Store Connect
2. **Use semantic build numbers** (increment by 1)
3. **Verify git is clean** before running deployment
4. **Monitor App Store Connect** after upload for processing status
5. **Keep release notes ready** for App Store submission

## 🔐 Security

- Scripts use `xcodebuild` with `-allowProvisioningUpdates` for automatic signing
- No sensitive credentials are stored in scripts
- Uses system Xcode keychain for Apple Developer authentication

## 📝 Changelog

- **v1.0.0** - Initial automated deployment script
- **Fix** - Dynamic versioning in Info.plist
- **Enhancement** - Automatic cleanup of old archives
- **Feature** - Skip upload option for testing