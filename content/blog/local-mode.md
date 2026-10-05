---
title: When your iPhone can stand in for the relay
description: Local Mode keeps controls available on your Apple device while the relay is offline.
date: 2026-10-05
category: news
author: Rob Parker
tags: [local-mode, reliability, iphone]
---

If your relay goes offline, Homecast can use your iPhone's own access to Apple Home. You can still control accessories and run scenes.

This is **Local Mode**, available to Cloud accounts in the iPhone, iPad and Mac apps. The device needs Apple Home access and HomeKit permission.

The badge shows **Standing in** until Homecast switches back to the relay. Tap it to check the connection; your layout stays the same.

![The normal connection through the relay, and a direct connection from an iPhone to Apple Home](/blog/local-mode/paths.svg "Local Mode uses this device's own access to Apple Home.")

Keep Homecast open on iPhone and iPad. Local Mode only helps that device; Android, browsers, Homecast automations and history recording still need the relay.

<details>
<summary>Settings and limits</summary>

Notifications, cameras and share links also stay with the relay. Apple Home's own automations continue on its home hub.

It's **Automatic** by default. To choose **Always on** or **Off**, enable **Developer Mode** under **Settings → Account**, then open **Settings → Local Mode**.

This doesn't apply to Community Edition, where the Mac already runs the local server. The [Local Mode guide](https://docs.homecast.cloud/guides/local-mode) covers the connection rules.

</details>
