# 项目跟踪 Android App 制作指南（不依赖 Chrome）

## 方案说明

这个方案使用 Android 原生 WebView，**不依赖 Chrome 浏览器**，可以在任何 Android 手机上运行。

---

## 快速开始（使用 Android Studio）

### 步骤 1：创建新项目

1. 打开 Android Studio
2. 点击 **File → New → New Project**
3. 选择 **Empty Activity**
4. 填写项目信息：
   - **Name**: 项目跟踪
   - **Package name**: help.app_9you.twa
   - **Language**: Java
   - **Minimum SDK**: API 23 (Android 6.0)
5. 点击 **Finish**

### 步骤 2：修改 AndroidManifest.xml

打开 `app/src/main/AndroidManifest.xml`，替换为：

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="help.app_9you.twa">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">
        
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
```

### 步骤 3：修改 MainActivity.java

打开 `app/src/main/java/help/app_9you/twa/MainActivity.java`，替换为：

```java
package help.app_9you.twa;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        WebSettings webSettings = webView.getSettings();
        
        // 启用 JavaScript
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        
        // 支持缩放
        webSettings.setSupportZoom(true);
        webSettings.setBuiltInZoomControls(true);
        webSettings.setDisplayZoomControls(false);
        
        // 使用 WebViewClient 而不是默认浏览器
        webView.setWebViewClient(new WebViewClient());
        
        // 加载网页
        webView.loadUrl("https://9you.help");
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
```

### 步骤 4：修改布局文件

打开 `app/src/main/res/layout/activity_main.xml`，替换为：

```xml
<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <WebView
        android:id="@+id/webview"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

</RelativeLayout>
```

### 步骤 5：修改字符串资源

打开 `app/src/main/res/values/strings.xml`，替换为：

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">项目跟踪</string>
</resources>
```

### 步骤 6：修改样式资源

打开 `app/src/main/res/values/themes.xml`（或 styles.xml），替换为：

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.Jiuyou" parent="Theme.AppCompat.Light.NoActionBar">
        <item name="colorPrimary">#4a6cf7</item>
        <item name="colorPrimaryDark">#3a5ce5</item>
        <item name="colorAccent">#4a6cf7</item>
    </style>
</resources>
```

### 步骤 7：构建并签名 APK

1. 点击菜单 **Build → Generate Signed Bundle / APK**
2. 选择 **APK**
3. 使用之前的密钥库：
   - **Key store path**: 选择 `jiuyou.keystore`
   - **Key store password**: jiuyou123
   - **Key alias**: jiuyou
   - **Key password**: jiuyou123
4. 选择 **release** 构建类型
5. 点击 **Finish**

---

## 优势对比

| 特性 | TWA 方案 | WebView 方案 |
|---|---|---|
| **依赖 Chrome** | ✅ 必须安装 Chrome | ❌ 不依赖 |
| **全屏显示** | ✅ 自动全屏 | ✅ 自动全屏 |
| **离线支持** | ❌ 需要网络 | ⚠️ 需要网络（但可配置缓存） |
| **性能** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **制作难度** | ⭐ | ⭐⭐⭐ |

---

## 注意事项

1. **网络要求**：WebView 方案仍然需要网络连接才能加载网页内容
2. **缓存**：可以配置 WebView 缓存策略，提升加载速度
3. **Digital Asset Links**：WebView 方案**不需要**配置 assetlinks.json
4. **图标**：可以替换 `res/mipmap` 目录下的图标文件

---

## 完成！

构建完成后，将 APK 安装到手机即可使用，**无需安装 Chrome 浏览器**！
