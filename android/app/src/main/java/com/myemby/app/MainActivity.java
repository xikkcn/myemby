package com.myemby.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前注册自定义插件
        registerPlugin(MyembyProxyPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
