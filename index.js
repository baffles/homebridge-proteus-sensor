var request = require("request");
var poll = require("polling-to-event");

var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
	var Service = homebridge.hap.Service;
	var Characteristic = homebridge.hap.Characteristic;

	Accessory = homebridge.platformAccessory;
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	UUIDGen = homebridge.hap.uuid;

	homebridge.registerAccessory("homebridge-proteus-sensor", "ProteusSensor", ProteusSensor, true);
}

function ProteusSensor(log, config, api) {
	var platform = this;
	this.log = log;
	this.config = config;
	this.api = api;

	if (config.sensors) {
		config.sensors.forEach(function(sensor) {
			platform.sensors[sensor.name] = {
				name: sensor.name,
				uuid: UUIDGen.generate(sensor.name),
				type: sensor.type,
				invert: !!sensor.invert,
				host: sensor.host,
				url: sensor.url || ('http://' + sensor.host + '/status.json'),
				interval: sensor.interval || 2000,
			};
		});
	}

	this.api.on('didFinishLaunching', function() {
		platform.log('finished launching, configuring new accessories...');
		platform.sensors.forEach(function(sensor) {
			if (!sensor.accessory) {
				sensor.accessory = new Accessory(sensor.name, sensor.uuid);
				sensor.accessory.reachable = false; // we'll update at first poll
				platform.setupSensor(sensor);
			}
		});
	});
};

ProteusSensor.prototype.configureAccessory = function(accessory) {
	var platform = this;
	platform.log(accessory.displayName, "configure accessory");

	// we'll mark it reachable once we poll it for the first time
	accessory.reachable = false;

	var sensor = platform.sensors[accessory.displayName];
	if (!sensor) return;

	sensor.accessory = accessory;
	this.setupSensor(sensor);
};

ProteusSensor.prototype.setupSensor = function(sensor) {
	var platform = this;
	platform.log(sensor.name, "setup sensor communications");

	// we don't have a way to identify
	sensor.accessory.on('identify', function(paired, callback) {
		platform.log(sensor.name, "identify requested");
		callback();
	});

	sensor.infoService = sensor.accessory.getService(Service.AccessoryInformation);
	if (!sensor.infoService) sensor.infoService = sensor.accessory.addService(Service.AccessoryInformation);
	sensor.infoService
		.setCharacteristic(Characteristic.Manufacturer, "Proteus")
		.setCharacteristic(Characteristic.SerialNumber, "Unknown")
		.setCharacteristic(Characteristic.FirmwareRevision, "Unknown");

	switch (sensor.type) {
		case 'level':
			sensor.infoService.setCharacteristic(Characteristic.Model, "Level Sensor");

			sensor.leakService = sensor.accessory.getService(Service.LeakSensor);
			if (!sensor.leakService) sensor.leakService = sensor.accessory.addService(Service.LeakSensor);
			sensor.leakDetected = sensor.leakService.getCharacteristic(Characteristic.LeakDetected);
			sensor.statusActive = sensor.leakService.getCharacteristic(Characteristic.StatusActive);
			sensor.statusFault = sensor.leakService.getCharacteristic(Characteristic.StatusFault);

			platform.setupPolling(sensor);

			break;

		default:
			sensor.infoService.setCharacteristic(Characteristic.Model, "Unknown");
			platform.log(sensor.name, "unknown sensor type: " + sensor.type);
			break;
	}
};

ProteusSensor.prototype.setupPolling = function(sensor) {
	var platform = this;
	platform.log(sensor.name, "intialize polling");

	sensor.emitter = poll(function(done) {
		request({ method: 'GET', url: sensor.url }, function(err, resp, data) { done(err, JSON.parse(data)); });
	}, {
		interval: sensor.interval,
		longpolling: true
	});

	sensor.emitter.on("error", function(err) {
		platform.log(accessory.displayName, "error polling sensor status", err);
		sensor.accessory.updateReachability(false);
	});

	sensor.emitter.on("longpoll", function(data) {
		sensor.infoService
			.setCharacteristic(Characteristic.SerialNumber, data.sid)
			.setCharacteristic(Characteristic.FirmwareRevision, data.ver);

		switch (sensor.type) {
			case "level":
				var properType = data.lvlSW == 1;
				sensor.statusActive.setValue(properType && (data.sta == 0 || data.sta == 3));
				sensor.statusFault.setValue(data.sta == 3);
				// data.lvl: 0 is high, 1 is low
				// if invert is true, trigger on low, otherwise trigger high
				sensor.leakDetected.setValue(sensor.invert ^ !data.lvl);
				break;
		}
	});
};