"""Writes CampFinder.xcodeproj/project.pbxproj (plain Xcode project, no CocoaPods/npm)."""
import hashlib
from pathlib import Path

HERE = Path(__file__).parent
BUNDLE_ID = "au.com.gonelappin.campfinder"


def gid(name):
    return hashlib.md5(name.encode()).hexdigest()[:24].upper()


I = {k: gid(k) for k in [
    "project", "root", "appgroup", "products", "target", "product",
    "f_app", "f_view", "f_assets", "f_web",
    "b_app", "b_view", "b_assets", "b_web",
    "ph_src", "ph_res", "ph_fw",
    "cl_proj", "cl_tgt", "c_proj_dbg", "c_proj_rel", "c_tgt_dbg", "c_tgt_rel",
]}

common_proj = """				ALWAYS_SEARCH_USER_PATHS = NO;
				ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = YES;
				CLANG_ENABLE_MODULES = YES;
				CLANG_ENABLE_OBJC_ARC = YES;
				COPY_PHASE_STRIP = NO;
				ENABLE_STRICT_OBJC_MSGSEND = YES;
				ENABLE_USER_SCRIPT_SANDBOXING = YES;
				GCC_C_LANGUAGE_STANDARD = gnu17;
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
				LOCALIZATION_PREFERS_STRING_CATALOGS = YES;
				SDKROOT = iphoneos;
				SWIFT_VERSION = 5.0;"""

tgt = f"""				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = "";
				ENABLE_PREVIEWS = YES;
				GENERATE_INFOPLIST_FILE = YES;
				INFOPLIST_FILE = CampFinder/Info.plist;
				INFOPLIST_KEY_CFBundleDisplayName = "Camp Finder";
				INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO;
				INFOPLIST_KEY_LSApplicationCategoryType = "public.app-category.travel";
				INFOPLIST_KEY_NSCameraUsageDescription = "Camp Finder uses the camera so you can share photos of camps with other travellers.";
				INFOPLIST_KEY_NSPhotoLibraryUsageDescription = "Camp Finder lets you choose photos of camps to share with other travellers.";
				INFOPLIST_KEY_NSLocationWhenInUseUsageDescription = "Camp Finder uses your location to show camps near you and to give directions from where you are.";
				INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
				INFOPLIST_KEY_UILaunchScreen_Generation = YES;
				INFOPLIST_KEY_UIStatusBarStyle = UIStatusBarStyleDefault;
				INFOPLIST_KEY_UISupportedInterfaceOrientations = UIInterfaceOrientationPortrait;
				INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight";
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
				);
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = {BUNDLE_ID};
				PRODUCT_NAME = "$(TARGET_NAME)";
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SUPPORTS_MACCATALYST = NO;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";"""

pbx = f"""// !$*UTF8*$!
{{
	archiveVersion = 1;
	classes = {{
	}};
	objectVersion = 56;
	objects = {{

/* Begin PBXBuildFile section */
		{I['b_app']} /* CampFinderApp.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {I['f_app']} /* CampFinderApp.swift */; }};
		{I['b_view']} /* WebAppView.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {I['f_view']} /* WebAppView.swift */; }};
		{I['b_assets']} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {I['f_assets']} /* Assets.xcassets */; }};
		{I['b_web']} /* web in Resources */ = {{isa = PBXBuildFile; fileRef = {I['f_web']} /* web */; }};
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		{I['product']} /* CampFinder.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = CampFinder.app; sourceTree = BUILT_PRODUCTS_DIR; }};
		{I['f_app']} /* CampFinderApp.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = CampFinderApp.swift; sourceTree = "<group>"; }};
		{I['f_view']} /* WebAppView.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = WebAppView.swift; sourceTree = "<group>"; }};
		{I['f_assets']} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; }};
		{I['f_web']} /* web */ = {{isa = PBXFileReference; lastKnownFileType = folder; path = web; sourceTree = "<group>"; }};
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
		{I['ph_fw']} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		{I['root']} = {{
			isa = PBXGroup;
			children = (
				{I['appgroup']} /* CampFinder */,
				{I['products']} /* Products */,
			);
			sourceTree = "<group>";
		}};
		{I['products']} /* Products */ = {{
			isa = PBXGroup;
			children = (
				{I['product']} /* CampFinder.app */,
			);
			name = Products;
			sourceTree = "<group>";
		}};
		{I['appgroup']} /* CampFinder */ = {{
			isa = PBXGroup;
			children = (
				{I['f_app']} /* CampFinderApp.swift */,
				{I['f_view']} /* WebAppView.swift */,
				{I['f_web']} /* web */,
				{I['f_assets']} /* Assets.xcassets */,
			);
			path = CampFinder;
			sourceTree = "<group>";
		}};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		{I['target']} /* CampFinder */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {I['cl_tgt']} /* Build configuration list for PBXNativeTarget "CampFinder" */;
			buildPhases = (
				{I['ph_src']} /* Sources */,
				{I['ph_fw']} /* Frameworks */,
				{I['ph_res']} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = CampFinder;
			productName = CampFinder;
			productReference = {I['product']} /* CampFinder.app */;
			productType = "com.apple.product-type.application";
		}};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		{I['project']} /* Project object */ = {{
			isa = PBXProject;
			attributes = {{
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 1500;
				LastUpgradeCheck = 1500;
				TargetAttributes = {{
					{I['target']} = {{
						CreatedOnToolsVersion = 15.0;
					}};
				}};
			}};
			buildConfigurationList = {I['cl_proj']} /* Build configuration list for PBXProject "CampFinder" */;
			compatibilityVersion = "Xcode 14.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = {I['root']};
			productRefGroup = {I['products']} /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				{I['target']} /* CampFinder */,
			);
		}};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		{I['ph_res']} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{I['b_assets']} /* Assets.xcassets in Resources */,
				{I['b_web']} /* web in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		{I['ph_src']} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{I['b_app']} /* CampFinderApp.swift in Sources */,
				{I['b_view']} /* WebAppView.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
		{I['c_proj_dbg']} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
{common_proj}
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_TESTABILITY = YES;
				GCC_OPTIMIZATION_LEVEL = 0;
				GCC_PREPROCESSOR_DEFINITIONS = (
					"DEBUG=1",
					"$(inherited)",
				);
				ONLY_ACTIVE_ARCH = YES;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG $(inherited)";
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
			}};
			name = Debug;
		}};
		{I['c_proj_rel']} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
{common_proj}
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				ENABLE_NS_ASSERTIONS = NO;
				SWIFT_COMPILATION_MODE = wholemodule;
				VALIDATE_PRODUCT = YES;
			}};
			name = Release;
		}};
		{I['c_tgt_dbg']} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
{tgt}
			}};
			name = Debug;
		}};
		{I['c_tgt_rel']} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
{tgt}
			}};
			name = Release;
		}};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		{I['cl_proj']} /* Build configuration list for PBXProject "CampFinder" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{I['c_proj_dbg']} /* Debug */,
				{I['c_proj_rel']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{I['cl_tgt']} /* Build configuration list for PBXNativeTarget "CampFinder" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{I['c_tgt_dbg']} /* Debug */,
				{I['c_tgt_rel']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
/* End XCConfigurationList section */
	}};
	rootObject = {I['project']} /* Project object */;
}}
"""
out = HERE / "CampFinder.xcodeproj" / "project.pbxproj"
out.parent.mkdir(exist_ok=True)
out.write_text(pbx)
print("wrote", out, len(set(I.values())), "unique ids of", len(I))
