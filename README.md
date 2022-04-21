# Signal K Plugin for StarLink

This plugin allows getting statistics from Starlink Dishy and allows auto-stowing it while the vessel is moving. It will automatically unstow the Dishy when the vessels becomes stationary again at an anchorage or dock. It will take 10 minutes for the plugin to detect if the vessel is moving or stationary.

Currently publishing the following information under `network.providers.starlink`:
* `status`: Either "online" or "offline"
* `downlink_throughput`: Downlink throughput in bits per second
* `uplink_throughput`: Uplink throughput in bits per second
* `outage` (only when status if offline): A JSON providing details of outage (cause, time, duration, etc.)

Starlink proto files are originally sourced from Elias Wilken's [starlink-rs](https://github.com/ewilken/starlink-rs) repository and have been modified.
