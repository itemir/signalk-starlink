/*
 * Copyright 2022-2024 Ilker Temir <ilker@ilkertemir.com>
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

const STARLINK = 'network.providers.starlink'

const POLL_STARLINK_INTERVAL = 15; // Poll every 15 seconds
const POLL_GPS_INTERVAL = 1; // Poll every second
const SPEED_SMOOTHING_RANGE = 10; // How many speed values to average

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
var previousLatitude;
var previousLongitude;

var recordedSpeeds=[];

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];
  var gpsPollProcess;
  var dishdataPollProcess;

  plugin.id = "signalk-starlink";
  plugin.name = "Starlink";
  plugin.description = "Starlink plugin for Signal K";

  plugin.schema = {
    type: 'object',
    required: [],
    properties: {
      retrieveGps: {
        type: "boolean",
        title: "Use Starlink as a GPS source (requires enabling access on local network)",
        description: "Further instructions available at https://github.com/itemir/signalk-starlink/blob/main/README.md",
	      default: true
      },
      stowWhileMoving: {
        type: "boolean",
        title: "Stow Dishy while moving",
	      default: false
      },
      gpsSource: {
        type: "string",
        title: "GPS source (Optional - only if you have multiple GPS sources and you want to use an explicit source)",
        description: "Used to determine if the vessel is underway for automatic stowing of Dishy.",
      },
      enableStatusNotification: {
        type: "boolean",
        title: "Send a notification when offline",
	default: true
      },
      statusNotificationState: {
        title: 'State',
        description:
          'When an offline notifcation is sent, this wil be used as the notitication state',
        type: 'string',
        default: 'warn',
        enum: ['alert', 'warn', 'alarm', 'emergency']
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

    dishdataPollProcess = setInterval( function() {

    	client.Handle({
    	  'get_status': {}
  	  }, (error, response) => {
	      if (error) {
	        app.debug(`Error reading from Dishy.`);
	        if (errorCount++ >= 5) {
            client.close();
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
          updates: [{
              values: values
          }]
        });

        if ( options.enableStatusNotification === undefined || options.enableStatusNotification === true ) {
          const path = `notifications.${STARLINK}.state`
          let state = dishyStatus !== 'online'
              ? options.statusNotificationState || 'warn'
              : 'normal'
          
          let method = ['visual', 'sound']
          const existing = app.getSelfPath(path)
          if (existing && existing.state !== 'normal' && existing.method ) {
            method = existing.method
          }
          const status = dishyStatus === 'online' ? 'online' : 'offline'
          app.handleMessage('signalk-starlink', {
            updates: [{
              values: [{
                path, 
                value: {
                  state,
                  method,
                  message: `starlink is ${status}`
                }   
              }]
            }]
          })
        }
      });
    }, POLL_STARLINK_INTERVAL * 1000)

    gpsPollProcess = setInterval( function() {
      if (options.retrieveGps) {
          client.Handle({
            'get_location': {}
          }, (error, response) => {
          if (error) {
            app.debug('Cannot retrieve position from Starlink');
            return;
          }
          let latitude = response.get_location.lla.lat;
          let longitude = response.get_location.lla.lon;
          let values;
          if ((previousLatitude) && (previousLongitude)) {
            courseAndSpeedOverGround = calculateCourseAndSpeed(
              POLL_GPS_INTERVAL,
              previousLatitude,
              previousLongitude,
              latitude,
              longitude
            );

            recordSpeed(courseAndSpeedOverGround.speed);

            values = [
              {
                path: 'navigation.position',
                value: {
                  'longitude': longitude,
                  'latitude': latitude
                },
                }, {
                  path: 'navigation.courseOverGroundTrue',
                  value: courseAndSpeedOverGround.course
                }, {
                  path: 'navigation.speedOverGround',
                  value: smoothSpeed()
                }
            ]
          } else {
            values = [
              {
                path: 'navigation.position',
                value: {
                  'longitude': longitude,
                  'latitude': latitude
                }
              }
            ]
                }
          app.handleMessage('signalk-starlink', {
            updates: [{
                values: values
              }]
          });
          previousLatitude = latitude;
          previousLongitude = longitude;
          app.debug(`Position received from Starlink (${latitude}, ${longitude})`);
        });
      }
    }, POLL_GPS_INTERVAL * 1000);
  }

  plugin.stop =  function() {
    clearInterval(dishdataPollProcess);
    clearInterval(gpsPollProcess);
    app.setPluginStatus('Pluggin stopped');
  };

  function recordSpeed(value) {
    
    recordedSpeeds.push(value);
    
    if (recordedSpeeds.length > SPEED_SMOOTHING_RANGE) {

      recordedSpeeds.shift();
    }
  }

  function smoothSpeed() {

    if(recordedSpeeds.length == 0) return 0;
    
    return recordedSpeeds.reduce((a, b) => a + b, 0) / recordedSpeeds.length; 
  }

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


  function haversineDistance(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
    
    function toRad(degree) {
        return degree * Math.PI / 180;
    }
    
    const lat1 = toRad(lat1Deg);
    const lon1 = toRad(lon1Deg);
    const lat2 = toRad(lat2Deg);
    const lon2 = toRad(lon2Deg);
    
    const { sin, cos, sqrt, atan2 } = Math;
    
    const R = 6371; // earth radius in km 
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1) * cos(lat2)
            * sin(dLon / 2) * sin(dLon / 2);
    const c = 2 * atan2(sqrt(a), sqrt(1 - a)); 
    const d = R * c;
    
    return d * 1000; // distance in m
  }

  function calculateCourseAndSpeed(interval, lat1, lon1, lat2, lon2) {

    // Calculate distance between the two points
    const distance = haversineDistance(lat1, lon1, lat2, lon2);

    // Calculate speed over ground (SOG) in meters per second
    const speed = distance / interval;

    // Calculate course over ground (COG) in radians
    const angle = Math.atan2(lon2 - lon1, lat2 - lat1);
    const course = angle < 0 ? angle + 2 * Math.PI : angle;

    return { course, speed };
  }

  return plugin;
}
