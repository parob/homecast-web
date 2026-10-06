---
title: Introducing Homecast
description: Homecast's first public release brings Apple Home to Android, browsers and Home Assistant.
date: 2026-10-05
category: news
author: Rob Parker
featured: true
cover: /blog/introducing-homecast/dashboard.webp
coverAlt: Homecast dashboard with rooms, scenes and accessory controls
tags: [launch, apple-home, android, sharing, automations, home-assistant]
---

I'm sharing the first public release of **Homecast**. It lets you control your Apple Home from Android or a browser, and connect the same accessories to Home Assistant and your own scripts.

Your existing rooms, scenes and automations stay in Apple Home. There's no need to pair everything again, and you can keep using the Home app and Siri.

![Homecast dashboard with rooms, scenes and accessory controls](/blog/introducing-homecast/dashboard.webp "The Homecast dashboard, shown with example data.")

## Apple Home from Android

Use the Android app or open Homecast in a browser, including on Windows and Linux. There are apps for iPhone, iPad and Mac too.

You can [invite someone you live with or send a visitor a guest link](https://docs.homecast.cloud/guides/sharing). Choose what they can control, and add a passcode or expiry date for guests.

Household invitations use Homecast Cloud; Community Edition has local sharing.

## Automations

There's a visual editor for automations, with support for web requests and JavaScript. One example is a hallway lamp that tells you when to leave for the train. The [automations guide](https://docs.homecast.cloud/guides/automations/) covers every node.

![A small lamp glowing pale green on a hallway shelf beside a key](/blog/introducing-homecast/lamp.webp)

## Look back at what happened

[Analytics](https://docs.homecast.cloud/guides/history) lets you look back at sensor readings, lighting activity and battery levels. Recording is off by default, and sharing history with guests is a separate setting.

<details>
<summary>See Analytics in action</summary>

![Homecast Analytics comparing lighting activity and temperatures in a room](/blog/introducing-homecast/analytics.webp "Lighting and temperature over a day, shown with example data.")

Analytics is available on every plan. Community Edition stores history on your Mac; Cloud accounts store it in your account.

</details>

## Home Assistant, scripts and AI assistants

You can bring your accessories into [Home Assistant](https://docs.homecast.cloud/guides/home-assistant), or ask [Claude or ChatGPT](https://docs.homecast.cloud/guides/ai-assistant) to create a scene. You choose which homes they can access and whether they can make changes.

For your own tools, there's a [REST API](https://docs.homecast.cloud/reference/rest), [Python client](https://github.com/parob/pyhomecast) and MQTT support.

## What you need to run it

Homecast connects through a **relay**: a Mac with access to your Apple Home. Use your own, or have Homecast run one for you.

| | What you need |
|---|---|
| **Community Edition** | Your own Mac. Free, open source, with unlimited accessories on your local network. |
| **Cloud with your own relay** | Your own Mac and a Homecast account, with remote access through Homecast. |
| **Cloud Managed** | A paid Cloud plan and an Apple TV or HomePod at home. Homecast runs the relay; you don't need a Mac. |

Your own relay needs to stay awake. New Cloud accounts may still need waiting-list approval. See [pricing](/pricing) for the plan limits.

<details>
<summary>Start with Community Edition</summary>

Install Homecast on your Mac, choose **Community**, and grant HomeKit permission. Connect from the Android app or a browser on the same network using the relay's address.

There's no Homecast account or subscription. Remote use needs a VPN or tunnel; the [setup guide](https://docs.homecast.cloud/guides/community-edition) covers that.

The [source](https://github.com/parob/homecast) is available under the MIT licence.

</details>

<details>
<summary>Start with Homecast Cloud</summary>

[Create an account](/signup), then connect a [relay on your Mac](https://docs.homecast.cloud/guides/self-hosted) or follow the [Cloud Managed setup](https://docs.homecast.cloud/guides/cloud-managed).

Basic is free and ad-supported, with up to ten accessories on your own relay. The Cloud plan includes a managed relay.

Managed setup needs an Apple Home invitation, so allow time for it to connect.

</details>

<details>
<summary>What about cameras?</summary>

[Camera stills and live view](https://docs.homecast.cloud/guides/dashboard#cameras) need a Cloud Managed relay. Your own Mac isn't supported yet. There's no audio, recording or camera access through guest links.

</details>

## Give it a try

<div class="blog-actions">
<a class="blog-action-primary" href="https://apps.apple.com/gb/app/homecast-app/id6759559232?mt=12" target="_blank" rel="noopener noreferrer">Download for Mac</a>
<a href="https://play.google.com/store/apps/details?id=cloud.homecast.app" target="_blank" rel="noopener noreferrer">Get the Android app</a>
<a href="/signup">Try Homecast Cloud</a>
</div>

I'd like to hear how you get on, especially if setup leaves you stuck. Send feedback through [Support](/support), or [open an issue on GitHub](https://github.com/parob/homecast/issues).
