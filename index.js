/*
 * Copyright 2022 Ilker Temir <ilker@ilkertemir.com>
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const POLL_STARLINK_INTERVAL = 2      // Poll every N seconds
const STARLINK = 'network.providers.starlink'

const path = require('path');
const protoLoader = require('@grpc/proto-loader');
const grpc = require('@grpc/grpc-js');
const gRpcOptions = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [path.join(__dirname, '/protos')]
}
const packageDefinition = protoLoader.loadSync('spacex/api/device/service.proto', gRpcOptions);
const Device  = grpc.loadPackageDefinition(packageDefinition).SpaceX.API.Device.Device;
var client = new Device(
    "192.168.100.1:9200",
    grpc.credentials.createInsecure()
);

var dishyStatus;
var stowRequested;
var positions = [];
var gpsSource;
var errorCount = 0;

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];
  var pollProcess;

  plugin.id = "signalk-starlink";
  plugin.name = "Starlink";
  plugin.description = "Starlink plugin for Signal K";

  plugin.schema = {
    type: 'object',
    required: [],
    properties: {
      stowWhileMoving: {
        type: "boolean",
        title: "Stow Dishy while moving",
	default: false
      },
      gpsSource: {
        type: "string",
        title: "GPS source (Optional - only if you have multiple GPS sources and you want to use an explicit source)"
      },
    }
  }

  plugin.start = function(options) {
    gpsSource = options.gpsSource;
    let subscription = {
      context: 'vessels.self',
      subscribe: [{
        path: 'navigation.position',
        period: 60 * 1000     // Every minute
      }]
    };

    app.subscriptionmanager.subscribe(subscription, unsubscribes, function() {
      app.debug('Subscription error');
    }, data => processDelta(options, data));

    pollProcess = setInterval( function() {
    	client.Handle({
    	  'get_status': {}
  	}, (error, response) => {
	  if (error) {
	    app.debug(`Error reading from Dishy.`);
	    if (errorCount++ > 30) {
              client = new Device(
    		"192.168.100.1:9200",
    		grpc.credentials.createInsecure()
	      );
	      errorCount = 0;
	      app.debug(`Retrying connection`);
	    }
	    return;
	  }
	  let values;
          if (response.dish_get_status.outage) {
	    let duration = response.dish_get_status.outage.duration_ns / 1000 / 1000 /1000;
	    duration = timeSince(duration);
            app.setPluginStatus(`Starlink has been offline (${response.dish_get_status.outage.cause}) for ${duration}`);
	    dishyStatus = response.dish_get_status.outage.cause;
 
	    values = [
	      {
	        path: `${STARLINK}.status`,
	        value: 'offline'
	      },
	      {
	        path: `${STARLINK}.outage.cause`,
	        value: response.dish_get_status.outage.cause
	      },
	      {
	        path: `${STARLINK}.outage.start`,
	        value: new Date(response.dish_get_status.outage.start_timestamp_ns/1000/1000)
	      },
	      {
	        path: `${STARLINK}.outage.duration`,
	        value: response.dish_get_status.outage.duration_ns/1000/1000/1000
	      },
	      {
	        path: `${STARLINK}.uptime`,
	        value: response.dish_get_status.device_state.uptime_s
	      },
	      {
	        path: `${STARLINK}.hardware`,
	        value: response.dish_get_status.device_info.hardware_version
	      },
	      {
	        path: `${STARLINK}.software`,
	        value: response.dish_get_status.device_info.software_version
	      },
	      {
	        path: `${STARLINK}.alerts`,
	        value: response.dish_get_status.alerts
	      }
	    ];
	  } else {
	    if (dishyStatus != "online") {
              app.setPluginStatus('Starlink is online');
	      dishyStatus = "online";
	    }
	    values = [
	      {
	        path: `${STARLINK}.status`,
	        value: 'online'
	      },
	      {
	        path: `${STARLINK}.uptime`,
	        value: response.dish_get_status.device_state.uptime_s
	      },
	      {
	        path: `${STARLINK}.hardware`,
	        value: response.dish_get_status.device_info.hardware_version
	      },
	      {
	        path: `${STARLINK}.software`,
	        value: response.dish_get_status.device_info.software_version
	      },
	      {
	        path: `${STARLINK}.downlink_throughput`,
	        value: response.dish_get_status.downlink_throughput_bps || 0
	      },
	      {
	        path: `${STARLINK}.uplink_throughput`,
	        value: response.dish_get_status.uplink_throughput_bps || 0
	      },
	      {
	        path: `${STARLINK}.latency`,
	        value: response.dish_get_status.pop_ping_latency_ms
	      },
	      {
	        path: `${STARLINK}.alerts`,
	        value: response.dish_get_status.alerts
	      }
	    ];
	  }
	  app.handleMessage('signalk-starlink', {
            updates: [
              {
                values: values
              }
            ]
          });
	});
    }, POLL_STARLINK_INTERVAL * 1000);

  }

  plugin.stop =  function() {
    clearInterval(pollProcess);
    app.setPluginStatus('Pluggin stopped');
  };

  function stowDishy() {
    client.Handle({
      'dish_stow': {}
    }, (error, response) => {
      if (!error) {
        stowRequested = true;
      }
    });
  }

  function unstowDishy() {
    client.Handle({
      'dish_stow': {
        unstow: true
      }
    }, (error, response) => {
      if (!error) {
        stowRequested = false;
      }
    });
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    if ((lat1 == lat2) && (lon1 == lon2)) {
      return 0;
    }
    else {
      var radlat1 = Math.PI * lat1/180;
      var radlat2 = Math.PI * lat2/180;
      var theta = lon1-lon2;
      var radtheta = Math.PI * theta/180;
      var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
      if (dist > 1) {
          dist = 1;
      }
      dist = Math.acos(dist);
      dist = dist * 180/Math.PI;
      dist = dist * 60 * 1.1515;
      dist = dist * 0.8684; // Convert to Nautical miles
      return dist;
    }
  }

  function processDelta(options, data) {
    let source = data.updates[0]['$source'];
    let dict = data.updates[0].values[0];
    let path = dict.path;
    let value = dict.value;

    switch (path) {
      case 'navigation.position':
	if (!gpsSource) {
	  gpsSource = source;
	  app.debug(`Setting GPS source to ${source}.`);
	} else if (gpsSource != source) {
	  app.debug(`Ignoring position from ${source}.`);
	  break;
	}
        positions.unshift({
	  latitude: value.latitude,
	  longitude: value.longitude
	});
        positions = positions.slice(0, 10);         // Keep 10 minutes of positions
	if (positions.length < 10) {
	  app.debug(`Not enough position reports yet (${positions.length}) to calculate distance.`);
	  break;
	}
	let distance = 0;
	for (let i=1;i < positions.length;i++) {
	  let previousPosition = positions[i-1];
	  let position = positions[i];
	  distance = distance + calculateDistance(position.latitude,
		  				  position.longitude,
		  				  previousPosition.latitude,
		  				  previousPosition.longitude);
	}
	app.debug (`Distance covered in the last 10 minutes is ${distance} miles.`);
	if (options.stowWhileMoving && (distance >= 0.15)) {
	  if (dishyStatus == "online") {
	    app.debug (`Vessel is moving, stowing Dishy.`);
	    stowDishy();
	  } else {
	    app.debug(`Vessel is moving but Dishy is not online.`);
	  }
	} else {
	  if (dishyStatus == "online") {
	    app.debug (`Vessel is stationary, and dishy is not stowed.`);
	  } else if (dishyStatus == "STOWED") {
	    if (stowRequested) {
	      app.debug (`Vessel is stationary, and we previously stowed Dishy. Unstowing.`);
	      unstowDishy();
	    } else {
	      app.debug (`Vessel is stationary, and Dishy is stowed, but not by us. Ignoring.`);
	    }
	  }
        }	  
        break;
      case 'environment.wind.speedApparent':
        break;
      default:
        app.error('Unknown path: ' + path);
    }
  }

  function timeSince(seconds) {
    var interval = seconds / 31536000;
    if (interval > 1) {
      return Math.floor(interval) + " years";
    }
    interval = seconds / 2592000;
    if (interval > 1) {
      return Math.floor(interval) + " months";
    }
    interval = seconds / 86400;
    if (interval > 1) {
      return Math.floor(interval) + " days";
    }
    interval = seconds / 3600;
    if (interval > 1) {
      return Math.floor(interval) + " hours";
    }
    interval = seconds / 60;
    if (interval > 1) {
      return Math.floor(interval) + " minutes";
    }
    return Math.floor(seconds) + " seconds";
  }

  return plugin;
}
