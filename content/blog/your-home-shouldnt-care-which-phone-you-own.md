---
title: Use Apple Home from Android
description: Invite someone with an Android phone to your home, or give a visitor a guest link.
date: 2026-10-05
category: guide
author: Rob Parker
cover: /blog/your-home-shouldnt-care-which-phone-you-own/phone.webp
coverAlt: An Android phone on a wooden kitchen table
tags: [apple-home, android, sharing, family, notifications]
---

Homecast lets someone on Android use your Apple Home without pairing the accessories again. Everyone else can keep using Apple's Home app.

You'll need a relay that stays online: your own Mac, or one Homecast runs for you. A managed relay also needs an Apple home hub for remote access.

![An Android phone lying face down on a wooden kitchen table](/blog/your-home-shouldnt-care-which-phone-you-own/phone.webp)

## Invite someone at home

Household invitations work with Homecast Cloud, including the free plan. Right-click the home and choose **Share Home**, or use **⋯ → Share** on a phone. Under **Members**, press **+** and enter their email.

**Control** lets them use accessories and edit scenes and automations. **View** is read-only; **Admin** also manages access.

On their Android phone:

1. Install [Homecast](https://play.google.com/store/apps/details?id=cloud.homecast.app) and choose **Homecast Cloud**.
2. Sign up with the invited email address and verify it.
3. Accept the invitation.

Your plan covers their access. New accounts may still need waiting-list approval, even with an invitation.

<details>
<summary>Sharing screen and notification setup</summary>

![The home sharing dialog with the Members list and access settings](/blog/share-apple-home-with-android-family/share-dialog.webp "Members and guest links live in the same dialog.")

While signed in, enable notification permission and try **Settings → Notifications → Send Test**. Automations can then send push notifications to accepted members through a **Notify** step.

Mute this phone under **Settings → Notifications**, or a home or automation under **Settings → Homes → your home → Notifications**. Other people's phones aren't affected.

An admin can remove people from the Members list. Members can't remove themselves yet.

</details>

## Give a visitor a link

A guest link opens in a browser with no account needed. Open **Share** on the home, room or accessory you want to share.

Leave **Public Access** off to require a passcode. Give the code **Control** or **View** access and an expiry date.

<details>
<summary>Passcodes, schedules and ending access</summary>

![Passcode settings with start and expiry dates and a weekly access window](/blog/share-apple-home-with-android-family/passcode.webp "Limited Access controls when a passcode works.")

You can set a start date and weekly access windows. A window can't cross midnight. Outside those times, the code appears incorrect.

Delete a passcode to revoke it. If **Public Access** is on, turn it off separately; deleting the code won't close the public link.

The [sharing guide](https://docs.homecast.cloud/guides/sharing) covers all the access options.

</details>
