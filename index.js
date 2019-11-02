var request = require("request");
var poll = require("polling-to-event");

var Service, Characteristic;

module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;

	homebridge.registerAccessory("homebridge-proteus-sensor", "ProteusSensor", ProteusSensor);
}

function ProteusSensor(log, config) {
	this.log = log;
	this.config = config;

	this.name = config.name;
	this.type = config.type;
	this.invert = !!config.invert;
	this.host = config.host;
	this.url = config.url || ('http://' + this.host + '/status.json');
	this.interval = config.interval || 2000;
};

ProteusSensor.prototype.identify = function(callback) {
	// we don't have a way to identify
	this.log(this.name, "identify requested");
	callback();
}

ProteusSensor.prototype.getServices = function() {
	this.log(this.name, "get services");

	this.infoService = new Service.AccessoryInformation()
		.setCharacteristic(Characteristic.Manufacturer, "Proteus")
		.setCharacteristic(Characteristic.SerialNumber, "Unknown")
		.setCharacteristic(Characteristic.FirmwareRevision, "Unknown");

	var services = [ this.infoService ];

	switch (this.type) {
		case 'level':
			this.infoService.setCharacteristic(Characteristic.Model, "Level Sensor");

			this.leakService = new Service.LeakSensor();
			services.push(this.leakService);
			this.leakDetected = this.leakService.getCharacteristic(Characteristic.LeakDetected);
			this.statusActive = this.leakService.getCharacteristic(Characteristic.StatusActive);
			this.statusFault = this.leakService.getCharacteristic(Characteristic.StatusFault);

			this.setupPolling();

			break;

		default:
			this.infoService.setCharacteristic(Characteristic.Model, "Unknown");
			this.log(this.name, "unknown sensor type: " + this.type);
			break;
	}

	return services;
};

ProteusSensor.prototype.setupPolling = function() {
	var sensor = this;
	this.log(sensor.name, "intialize polling");

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