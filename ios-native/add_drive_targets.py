"""Adds Drive mode to CampFinder.xcodeproj: DriveMode.swift and the shared files in the app, and the
CampFinderWidgets extension (Live Activity + Nearby widget) embedded in the app. Safe to run twice.
Run: python3 ios-native/add_drive_targets.py
"""
import hashlib
import re
from pathlib import Path

PBX = Path(__file__).parent / "CampFinder.xcodeproj" / "project.pbxproj"
TEAM = "X6542QMADY"
APP_TARGET = "42AEFBAE01D2DFD981F7DA7D"
APP_SOURCES = "F6BE306E6A9E42DE559F6EDC"
APP_RESOURCES = "7414EC6B391964FAEC8B0E90"
APP_FRAMEWORKS = "A82E6F678DA6193022955957"
APP_GROUP = "20F4BD606C0F6D1645AE4919"
ROOT_GROUP = "63A9F0EA7BB98050796B649E"
PRODUCTS = "86024CAD1E83101D97359D73"
PROJECT = "46F86FAA6BBF9AC94A7E4595"


def gid(name):
    return hashlib.md5(("drive-" + name).encode()).hexdigest()[:24].upper()


I = {k: gid(k) for k in [
    "f_drive", "f_shared", "f_views", "f_places", "f_wsrc", "f_winfo", "f_wpriv", "w_product",
    "b_drive", "b_shared_app", "b_places_app", "b_shared_w", "b_views_w", "b_places_w", "b_wsrc", "b_wpriv", "b_embed",
    "g_shared", "g_widgets", "w_target", "w_src", "w_fw", "w_res", "w_dbg", "w_rel", "w_cl",
    "embed_phase", "proxy", "dep",
]}

W_SETTINGS = """				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = {build};
				DEVELOPMENT_TEAM = {team};
				GENERATE_INFOPLIST_FILE = YES;
				INFOPLIST_FILE = CampFinderWidgets/Info.plist;
				INFOPLIST_KEY_CFBundleDisplayName = "Camp Finder";
				INFOPLIST_KEY_NSHumanReadableCopyright = "";
				IPHONEOS_DEPLOYMENT_TARGET = 18.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = {version};
				PRODUCT_BUNDLE_IDENTIFIER = au.com.gonelappin.campfinder.widgets;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
				SUPPORTS_MACCATALYST = NO;
				SWIFT_EMIT_LOC_STRINGS = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = 1;"""


def insert_before(text, marker, block):
    i = text.index(marker)
    return text[:i] + block + text[i:]


def add_to_list(text, obj_id, key, entry):
    """Adds an entry to a list like `files = (` inside the object with this id."""
    m = re.search(re.escape(obj_id) + r" (/\*.*?\*/ )?= \{", text)
    start = m.end()
    k = text.index(f"{key} = (", start)
    close = text.index(");", k)
    return text[:close] + f"\t{entry},\n\t\t\t" + text[close:]


def add_engine(t):
    """Shared/DriveEngine.swift in the app (the logic behind Drive mode, kept apart so CI can test it)."""
    f, b = gid("f_engine"), gid("b_engine")
    if f in t:
        return t
    t = insert_before(t, "/* End PBXBuildFile section */", f"\t\t{b} /* DriveEngine.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {f} /* DriveEngine.swift */; }};\n")
    t = insert_before(t, "/* End PBXFileReference section */", f"\t\t{f} /* DriveEngine.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = DriveEngine.swift; sourceTree = \"<group>\"; }};\n")
    t = add_to_list(t, I["g_shared"], "children", f"{f} /* DriveEngine.swift */")
    t = add_to_list(t, APP_SOURCES, "files", f"{b} /* DriveEngine.swift in Sources */")
    print("added DriveEngine.swift")
    return t


def main():
    t = PBX.read_text()
    if I["w_target"] in t:
        n = add_engine(t)
        if n != t:
            PBX.write_text(n)
        print("already added")
        return
    version = re.search(r"MARKETING_VERSION = ([\d.]+);", t).group(1)
    build = re.search(r"CURRENT_PROJECT_VERSION = (\d+);", t).group(1)

    t = insert_before(t, "/* End PBXBuildFile section */", f"""		{I['b_drive']} /* DriveMode.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {I['f_drive']} /* DriveMode.swift */; }};
		{I['b_shared_app']} /* DriveShared.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {I['f_shared']} /* DriveShared.swift */; }};
		{I['b_places_app']} /* drive-places.json in Resources */ = {{isa = PBXBuildFile; fileRef = {I['f_places']} /* drive-places.json */; }};
		{I['b_shared_w']} /* DriveShared.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {I['f_shared']} /* DriveShared.swift */; }};
		{I['b_views_w']} /* DriveViews.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {I['f_views']} /* DriveViews.swift */; }};
		{I['b_places_w']} /* drive-places.json in Resources */ = {{isa = PBXBuildFile; fileRef = {I['f_places']} /* drive-places.json */; }};
		{I['b_wsrc']} /* CampFinderWidgets.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {I['f_wsrc']} /* CampFinderWidgets.swift */; }};
		{I['b_wpriv']} /* PrivacyInfo.xcprivacy in Resources */ = {{isa = PBXBuildFile; fileRef = {I['f_wpriv']} /* PrivacyInfo.xcprivacy */; }};
		{I['b_embed']} /* CampFinderWidgets.appex in Embed Foundation Extensions */ = {{isa = PBXBuildFile; fileRef = {I['w_product']} /* CampFinderWidgets.appex */; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};
""")

    t = insert_before(t, "/* Begin PBXFileReference section */", f"""/* Begin PBXContainerItemProxy section */
		{I['proxy']} /* PBXContainerItemProxy */ = {{
			isa = PBXContainerItemProxy;
			containerPortal = {PROJECT} /* Project object */;
			proxyType = 1;
			remoteGlobalIDString = {I['w_target']};
			remoteInfo = CampFinderWidgets;
		}};
/* End PBXContainerItemProxy section */

/* Begin PBXCopyFilesBuildPhase section */
		{I['embed_phase']} /* Embed Foundation Extensions */ = {{
			isa = PBXCopyFilesBuildPhase;
			buildActionMask = 2147483647;
			dstPath = "";
			dstSubfolderSpec = 13;
			files = (
				{I['b_embed']} /* CampFinderWidgets.appex in Embed Foundation Extensions */,
			);
			name = "Embed Foundation Extensions";
			runOnlyForDeploymentPostprocessing = 0;
		}};
/* End PBXCopyFilesBuildPhase section */

""")

    t = insert_before(t, "/* End PBXFileReference section */", f"""		{I['f_drive']} /* DriveMode.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = DriveMode.swift; sourceTree = "<group>"; }};
		{I['f_shared']} /* DriveShared.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = DriveShared.swift; sourceTree = "<group>"; }};
		{I['f_views']} /* DriveViews.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = DriveViews.swift; sourceTree = "<group>"; }};
		{I['f_places']} /* drive-places.json */ = {{isa = PBXFileReference; lastKnownFileType = text.json; path = "drive-places.json"; sourceTree = "<group>"; }};
		{I['f_wsrc']} /* CampFinderWidgets.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = CampFinderWidgets.swift; sourceTree = "<group>"; }};
		{I['f_winfo']} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};
		{I['f_wpriv']} /* PrivacyInfo.xcprivacy */ = {{isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; }};
		{I['w_product']} /* CampFinderWidgets.appex */ = {{isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = CampFinderWidgets.appex; sourceTree = BUILT_PRODUCTS_DIR; }};
""")

    t = insert_before(t, "/* End PBXFrameworksBuildPhase section */", f"""		{I['w_fw']} /* Frameworks */ = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
""")

    t = insert_before(t, "/* End PBXGroup section */", f"""		{I['g_shared']} /* Shared */ = {{
			isa = PBXGroup;
			children = (
				{I['f_shared']} /* DriveShared.swift */,
				{I['f_views']} /* DriveViews.swift */,
				{I['f_places']} /* drive-places.json */,
			);
			path = Shared;
			sourceTree = "<group>";
		}};
		{I['g_widgets']} /* CampFinderWidgets */ = {{
			isa = PBXGroup;
			children = (
				{I['f_wsrc']} /* CampFinderWidgets.swift */,
				{I['f_winfo']} /* Info.plist */,
				{I['f_wpriv']} /* PrivacyInfo.xcprivacy */,
			);
			path = CampFinderWidgets;
			sourceTree = "<group>";
		}};
""")
    t = add_to_list(t, APP_GROUP, "children", f"{I['f_drive']} /* DriveMode.swift */")
    t = add_to_list(t, ROOT_GROUP, "children", f"{I['g_shared']} /* Shared */")
    t = add_to_list(t, ROOT_GROUP, "children", f"{I['g_widgets']} /* CampFinderWidgets */")
    t = add_to_list(t, PRODUCTS, "children", f"{I['w_product']} /* CampFinderWidgets.appex */")

    t = insert_before(t, "/* End PBXNativeTarget section */", f"""		{I['w_target']} /* CampFinderWidgets */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {I['w_cl']} /* Build configuration list for PBXNativeTarget "CampFinderWidgets" */;
			buildPhases = (
				{I['w_src']} /* Sources */,
				{I['w_fw']} /* Frameworks */,
				{I['w_res']} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = CampFinderWidgets;
			productName = CampFinderWidgets;
			productReference = {I['w_product']} /* CampFinderWidgets.appex */;
			productType = "com.apple.product-type.app-extension";
		}};
""")
    t = add_to_list(t, APP_TARGET, "buildPhases", f"{I['embed_phase']} /* Embed Foundation Extensions */")
    t = add_to_list(t, APP_TARGET, "dependencies", f"{I['dep']} /* PBXTargetDependency */")
    t = add_to_list(t, PROJECT, "targets", f"{I['w_target']} /* CampFinderWidgets */")
    t = t.replace(f"""				TargetAttributes = {{
					{APP_TARGET} = {{
						CreatedOnToolsVersion = 15.0;
					}};""", f"""				TargetAttributes = {{
					{APP_TARGET} = {{
						CreatedOnToolsVersion = 15.0;
					}};
					{I['w_target']} = {{
						CreatedOnToolsVersion = 15.0;
					}};""")

    t = insert_before(t, "/* End PBXResourcesBuildPhase section */", f"""		{I['w_res']} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{I['b_places_w']} /* drive-places.json in Resources */,
				{I['b_wpriv']} /* PrivacyInfo.xcprivacy in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
""")
    t = add_to_list(t, APP_RESOURCES, "files", f"{I['b_places_app']} /* drive-places.json in Resources */")

    t = insert_before(t, "/* End PBXSourcesBuildPhase section */", f"""		{I['w_src']} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{I['b_wsrc']} /* CampFinderWidgets.swift in Sources */,
				{I['b_shared_w']} /* DriveShared.swift in Sources */,
				{I['b_views_w']} /* DriveViews.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
""")
    t = add_to_list(t, APP_SOURCES, "files", f"{I['b_drive']} /* DriveMode.swift in Sources */")
    t = add_to_list(t, APP_SOURCES, "files", f"{I['b_shared_app']} /* DriveShared.swift in Sources */")

    t = insert_before(t, "/* Begin PBXVariantGroup section */" if "/* Begin PBXVariantGroup section */" in t else "/* Begin XCBuildConfiguration section */", f"""/* Begin PBXTargetDependency section */
		{I['dep']} /* PBXTargetDependency */ = {{
			isa = PBXTargetDependency;
			target = {I['w_target']} /* CampFinderWidgets */;
			targetProxy = {I['proxy']} /* PBXContainerItemProxy */;
		}};
/* End PBXTargetDependency section */

""")

    ws = W_SETTINGS.format(build=build, team=TEAM, version=version)
    t = insert_before(t, "/* End XCBuildConfiguration section */", f"""		{I['w_dbg']} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
{ws}
			}};
			name = Debug;
		}};
		{I['w_rel']} /* Release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
{ws}
			}};
			name = Release;
		}};
""")
    t = insert_before(t, "/* End XCConfigurationList section */", f"""		{I['w_cl']} /* Build configuration list for PBXNativeTarget "CampFinderWidgets" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{I['w_dbg']} /* Debug */,
				{I['w_rel']} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
""")
    t = add_engine(t)
    PBX.write_text(t)
    print("added Drive mode and CampFinderWidgets", version, build)


if __name__ == "__main__":
    main()
