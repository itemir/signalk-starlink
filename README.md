# Signal K Plugin for Starlink

This plugin facilitates obtaining statistics from Starlink Dishy and optionally enables auto-stowing it while the vessel is in motion. If the option is enabled, it automatically unstows the Dishy when the vessel becomes stationary again, such as at an anchorage or dock. The plugin takes 10 minutes to detect if the vessel is moving or stationary.

Starlink also includes a GPS. You can optionally utilize it as a backup GPS for your Signal K network or NMEA 2000. To do so, grant location access on the local network using the Starlink app. Navigate to your Starlink app, and follow `Advanced -> Debug Data -> Allow access on local network (at the very bottom)`. Additionally, toggle on the Use Starlink as a GPS source option in the plugin configuration.

Currently, the plugin publishes the following information under network.providers.starlink:
* `status`: Either "online" or "offline"
* `hardware`: Starlink hardware version
* `software`: Starlink software version
* `uptime`: Uptime in seconds
* `downlink_throughput`: Downlink throughput in bits per second
* `uplink_throughput`: Uplink throughput in bits per second

Additional information is provided when Starlink is offline:
* `outage.cause`: Reason for the outage
* `outage.start`: Outage start date
* `outage.duration`: Duration of the outage in seconds

It also publishes the following if local GPS access is enabled (refer to the note above):
* `navigation.position`
* `navigation.courseOverGroundTrue`
* `navigation.speedOverGround`

Starlink proto files are originally sourced from Elias Wilken's [starlink-rs](https://github.com/ewilken/starlink-rs) repository and have been modified.
