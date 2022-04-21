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

const POLL_INTERVAL = 5      // Poll every N seconds
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
const client = new Device(
    "192.168.100.1:9200",
    grpc.credentials.createInsecure()
);

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
    properties: {}
  }

  plugin.start = function(options) {
     app.setPluginStatus(``);

    let subscription = {
      context: 'vessels.self',
      subscribe: [{
        path: 'navigation.position',
        period: POLL_INTERVAL * 1000
      }, {
        path: 'environment.wind.speedOverGround',
        period: POLL_INTERVAL * 1000
      }]
    };

    /*
    function processDelta(data) {
    }

    app.subscriptionmanager.subscribe(subscription, unsubscribes, function() {
      app.debug('Subscription error');
    }, data => processDelta(data));
    */

    pollProcess = setInterval( function() {
    	client.Handle({
    	  'get_status': {}
  	}, (error, response) => {
	  let values;
          if (response.dish_get_status.outage) {
	    values = [
	      {
	        path: `${STARLINK}.status`,
	        value: 'offline'
	      },
	      {
	        path: `${STARLINK}.outage`,
	        value: response.dish_get_status.outage
	      }
	    ];
	  } else {
	    values = [
	      {
	        path: `${STARLINK}.status`,
	        value: 'online'
	      },
	      {
	        path: `${STARLINK}.downlink_throughput`,
	        value: response.dish_get_status.downlink_throughput_bps
	      },
	      {
	        path: `${STARLINK}.uplink_throughput`,
	        value: response.dish_get_status.uplink_throughput_bps
	      },
	      {
	        path: `${STARLINK}.latency`,
	        value: response.dish_get_status.pop_ping_latency_ms
	      }
	    ];
	  }
	  app.handleMessage('signalk-ecowitt', {
            updates: [
              {
                values: values
              }
            ]
          });
	});
    }, POLL_INTERVAL * 1000);

  }

  plugin.stop =  function() {
    clearInterval(pollProcess);
    app.setPluginStatus('Pluggin stopped');
  };

  return plugin;
}
