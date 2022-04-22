# Signal K Plugin for Starlink

This plugin allows getting statistics from Starlink Dishy and allows auto-stowing it while the vessel is moving. It will automatically unstow the Dishy when the vessels becomes stationary again at an anchorage or dock. It will take 10 minutes for the plugin to detect if the vessel is moving or stationary.

Currently publishing the following information under `network.providers.starlink`:
* `status`: Either "online" or "offline"
* `hardware`: Starlink hardware version
* `software`: Starlink software version
* `uptime`: Uptime in seconds
* `downlink_throughput`: Downlink throughput in bits per second
* `uplink_throughput`: Uplink throughput in bits per second

Additional information when Starlink is offline:
* `outage.cause`: Reason of the outage 
* `outage.start`: Outage start date
* `outage.duration`: Duration of the outage in seconds

Starlink proto files are originally sourced from Elias Wilken's [starlink-rs](https://github.com/ewilken/starlink-rs) repository and have been modified.
