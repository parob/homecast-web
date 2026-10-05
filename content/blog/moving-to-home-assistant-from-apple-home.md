---
title: Using Apple Home with Home Assistant
description: Try Home Assistant with the accessories already in Apple Home, without pairing them again.
date: 2026-10-05
category: guide
author: Rob Parker
tags: [home-assistant, migration, mqtt]
---

You can try Home Assistant with your existing Apple Home accessories. Homecast connects them without re-pairing, so Siri and your scenes keep working. The Homecast relay needs to stay online.

## Add the integration

You'll need Home Assistant 2026.4 or later and [HACS](https://hacs.xyz).

1. In HACS, open **⋮ → Custom repositories**. Add `https://github.com/parob/homecast-hass` as an **Integration**.
2. Download **Homecast** and restart Home Assistant.
3. Open **Settings → Devices & services → Add integration → Homecast**.

Choose **Homecast Cloud** and sign in. Select your homes, then **View only** to read their state or **Full control** to make changes.

For Community Edition, choose **Homecast Community**. Select your relay or enter its address, such as `http://my-mac.local:5656`, and sign in.

Rooms become suggested areas. Renaming a device in Home Assistant doesn't change its name in Apple Home.

## Check the connection

Wait for a sensor update, then switch a light from Home Assistant. Before adding automations, check for existing rules that might change the same light.

Exclude Homecast entities from **HomeKit Bridge** to avoid duplicates in Apple Home. After adding new accessories, reload the Homecast integration.

<details>
<summary>Supported devices and the HomeKit Device alternative</summary>

The integration supports lights, switches, outlets, climate devices, blinds, fans, locks, security systems, common sensors and service groups. It doesn't yet expose garage doors, air purifiers, humidifiers, valves, speakers, TVs or cameras. Apple Home scenes and automations aren't exposed for running or editing.

Updates arrive live, with a full refresh every five minutes.

The [HomeKit Device integration](https://www.home-assistant.io/integrations/homekit_controller/) instead pairs accessories directly to Home Assistant. You must remove them from Apple Home first, then use HomeKit Bridge to add them back.

</details>

<details>
<summary>Already using MQTT?</summary>

In Community Edition, enable **Developer Mode** and add your broker under **Settings → Homes → your home → MQTT**. Turn on **HA Auto-Discovery** to publish discovery information.

For Homecast Cloud, enable **Homecast MQTT Broker** there. Connect to `mqtt.homecast.cloud` on TLS port 8883, with a blank username and a Homecast access token as the password. The cloud broker doesn't publish HA discovery; you'll need to define entities yourself.

The [MQTT reference](https://docs.homecast.cloud/reference/mqtt) has the connection details.

</details>

The [Home Assistant guide](https://docs.homecast.cloud/guides/home-assistant) covers the full setup.
