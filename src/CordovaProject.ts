/// <reference path="../dts/q.d.ts" />
/// <reference path="../dts/node.d.ts" />

import child = require('child_process');
import spawn = child.spawn;
import fs    = require('fs');
import path  = require('path');
import Q     = require('q');

interface CordovaProjectInfo {
	config: string;
	pluginNames: string[];
}

interface CordovaPluginInfo {
	id: string;
	version: string;
	name: string;
}

interface CordovaPlatformInfo {
	id: string;
	version: string;
}

interface CordovaActionResult {
	output: string;
	statusCode: number;
}

interface PluginAddOptions {
	searchPaths?: string[];
	noRegistry?: boolean;
	link?: boolean;
	save?: boolean;
	shrinkwrap?: boolean;
	
	experimentalBrowserify?: boolean;
}

interface ComponentRemoveOptions {
	save?: boolean;
}

interface PlatformAddOptions {
	useGit?: boolean;
	save?: boolean;
	link?: boolean;
}

interface _CordovaProject {
	// common
	prepare(platform?: string, args?: string[]): Q.Promise<CordovaActionResult>;
	compile(platform?: string, args?: string[]): Q.Promise<CordovaActionResult>;
	build(platform?: string, args?: string[]): Q.Promise<CordovaActionResult>;
	run(platform?: string, args?: string[]): Q.Promise<CordovaActionResult>;
	emulate(platform?: string, args?: string[]): Q.Promise<CordovaActionResult>;
	serve(): Q.Promise<CordovaActionResult>;
	
	getInfo(): Q.Promise<CordovaProjectInfo>;
	
	// plugin-related 
	getPlugins(): Q.Promise<Array<CordovaPluginInfo>>;
	addPlugin(searchSpec: string, options?: PluginAddOptions): Q.Promise<CordovaActionResult>;
	removePlugin(pluginId: string, options?: ComponentRemoveOptions): Q.Promise<CordovaActionResult>;
	
	// platform-related
	getPlatforms(): Q.Promise<Array<CordovaPlatformInfo>>;
	addPlatform(searchSpec: string, options?: PlatformAddOptions): Q.Promise<CordovaActionResult>;
	removePlatform(name: string, options?: ComponentRemoveOptions): Q.Promise<CordovaActionResult>;
	update(name?: string, options?: PlatformAddOptions): Q.Promise<CordovaActionResult>;
	checkForUpdates(): Q.Promise<Array<CordovaPlatformInfo>>;
}

function isWindows() {
	return process.platform.substr(0,3).toUpperCase() === 'WIN';
}

function safeSpawn(commandLine: string, arguments: string[], env: any): child.ChildProcess {
	if (isWindows()) {
		arguments.unshift(commandLine);
		arguments.unshift('/c');
		arguments.unshift('/s');
		
		return spawn('cmd', arguments, env);
	}
	else {
		return spawn(commandLine, arguments, env);
	}
}

class CordovaProject 
	implements _CordovaProject {
	
	private _path: string;
	
	constructor(path: string) {
		this._path = path;
	}

	static create(name: string, id?: string, title?: string): Q.Promise<CordovaProject> {
		var result = Q.defer<CordovaProject>();
		
		var spawnOpts = { cwd: process.cwd(), env: process.env };
		
		var args = ['create', name];
		if (id) {
			args.push(id);
		}
		
		if (title) {
			args.push(title);
		}
		
		var child = safeSpawn('cordova', args, spawnOpts);
		
		child.on('error', function(e) {
			result.reject(e);
		});
		
		var outBuffer = '';
		child.stdout.on('data', function(text) {
			outBuffer += text;
		});
		
		child.on('exit', function(code: number, signal: any) {
			if (code === 0) {
				var dir = path.join('.', name);
				CordovaProject.open(dir).then(function(proj) {
						result.resolve(proj);
					}, function(err) {
						result.reject(err);
					});
			}
			else {
				result.reject({ error: code, output: outBuffer });
			}
		})
		
		return result.promise;
	}
	
	static open(directoryName: string): Q.Promise<CordovaProject> {
		var result = Q.defer<CordovaProject>();
		
		var configxml = path.join(directoryName, 'config.xml');
		fs.stat(configxml, function(err, stat) {
			if (err) {
				result.reject('The selected path is not a Cordova application.');
			}
			
			result.resolve(new CordovaProject(directoryName));
		});
		
		return result.promise;
	}
	
	static version() {
		return '0.0.1-dev';
	}
	
	// common  
	prepare(platform?: string, args?: string[]): Q.Promise<CordovaActionResult> {
		return this.platformCommand('prepare', platform, args);
	}
	compile(platform?: string, args?: string[]): Q.Promise<CordovaActionResult> {
		return this.platformCommand('compile', platform, args);
	}
	build(platform?: string, args?: string[]): Q.Promise<CordovaActionResult> {
		return this.platformCommand('build', platform, args);
	}
	run(platform?: string, args?: string[]): Q.Promise<CordovaActionResult> {
		return this.platformCommand('run', platform, args);
	}
	emulate(platform?: string, args?: string[]): Q.Promise<CordovaActionResult> {
		return this.platformCommand('emulate', platform, args);
	}
	
	private platformCommand(commandName: string, platform?: string, args?: string[]): Q.Promise<CordovaActionResult> {
		var cmd = 'cordova ' + commandName + ' ';
		if (platform) {
			cmd += platform;
		}
		
		if (args) {
			cmd += ' ' + args.join(' ');
		}
		
		return CordovaProject.wrapVoidAction(cmd, this._path);
	}
	serve(): Q.Promise<CordovaActionResult> {
		return CordovaProject.wrapVoidAction('cordova serve', this._path);
	}
	
	getInfo(): Q.Promise<CordovaProjectInfo> {
		return CordovaProject.wrapStringAction('cordova info', this._path).then(function(result) {
			var lines = result.split('\n');
			var xml = '';
			var i = 0;
			for (; i < lines.length; i++) {
				xml += lines[i];
				if (lines[i].indexOf('</widget>') > -1) {
					break;
				}
			}
			
			var plugins = [];
			var lookingForPluginsColon = true,
			    enumeratingPlugins = false;
			for (; i < lines.length; i++) {
				if (lookingForPluginsColon) {
					if (lines[i].indexOf('Plugins:') > -1) {
						lookingForPluginsColon = false;
						enumeratingPlugins = true;
					}
				}
				else if (enumeratingPlugins) {
					if (lines[i].match(/\S/g)) {
						plugins.push(lines[i]);
					}
				}
			}
			
			return { config: xml, pluginNames: plugins };
		});
	}
	
	// plugin-related 
	getPlugins(): Q.Promise<Array<CordovaPluginInfo>> {
		var result = Q.defer<Array<CordovaPluginInfo>>();
		
		return CordovaProject.wrapStringAction('cordova plugin list', this._path).then(function(result) {
			var plugins = [];
			var lines = result.split('\n');
			
			lines.forEach(function(item) {
				var match = item.match(/(.+?) (.+?) "(.+?)"$/);
				if (match) {
					plugins.push({ 
						id: match[1],
						version: match[2],
						name: match[3]
					});
				}
			});
			
			return plugins;
		});	
		
		return result.promise;
	}
	
	addPlugin(searchSpec: string, options?: PluginAddOptions): Q.Promise<CordovaActionResult> {
		var cmd = 'cordova plugin add ' + searchSpec;
		if (options) {
			if (options.searchPaths) {
				cmd += ' --searchpath "' + options.searchPaths.join(isWindows() ? ';' : ':');
			}
			
			if (options.noRegistry) {
				cmd += ' --noregistry';
			}
			
			if (options.link) {
				cmd += ' --link';
			}
			
			if (options.save) {
				cmd += ' --save';
			}
			
			if (options.shrinkwrap) {
				cmd += ' --shrinkwrap';
			}
			
			if (options.experimentalBrowserify) {
				cmd += ' --browserify';
			}
		}
		
		return CordovaProject.wrapVoidAction(cmd, this._path);
	}
	
	removePlugin(pluginId: string, options?: ComponentRemoveOptions): Q.Promise<CordovaActionResult> {
		var cmd = 'cordova plugin remove ' + pluginId;
		if (options) {
			if (options.save) {
				cmd += ' --save';
			}
		}
		
		return CordovaProject.wrapVoidAction(cmd, this._path);
	}
	
	// platform-related
	getPlatforms(): Q.Promise<Array<CordovaPlatformInfo>> {
		var result = Q.defer<Array<CordovaPlatformInfo>>();
		
		return CordovaProject.wrapStringAction('cordova platform list', this._path).then(function(output) {
			var lines = output.split('\n');
			var installed = [];
			
			lines.forEach(function(line) {
				var searchStr = 'Installed platforms: ';
				if (line.indexOf(searchStr) === 0) {
					var rest = line.substring(searchStr.length);
					var platformPairs = rest.split(',');
					platformPairs.forEach(function(platformPair) {
						platformPair = platformPair.trim();
						var match = platformPair.match(/(.+?) (.+?)$/);
						if (match) {
							installed.push({ id: match[1], version: match[2] });
						}
					});
				}
			});
			
			return installed;
		});
		
		return result.promise;
	}
	
	addPlatform(searchSpec: string, options?: PlatformAddOptions): Q.Promise<CordovaActionResult> {
		var cmd = 'cordova platform add ' + searchSpec;
		if (options) {
			if (options.useGit) {
				cmd += ' --usegit';
			}
			
			if (options.save) {
				cmd += ' --save';
			}
			
			if (options.link) {
				cmd += ' --link';
			}
		}
		
		return CordovaProject.wrapVoidAction(cmd, this._path);
	}
	
	removePlatform(name: string, options?: ComponentRemoveOptions): Q.Promise<CordovaActionResult> {
		var cmd = 'cordova platform remove ' + name;
		if (options) {
			if (options.save) {
				cmd += ' --save';
			}
		}	
		
		return CordovaProject.wrapVoidAction(cmd, this._path);
	}
	
	update(name?: string, options?: PlatformAddOptions): Q.Promise<CordovaActionResult> {
		var cmd = 'cordova platform update';
		if (name) {
			cmd += ' ' + name;
		}	
		
		if (options) {
			if (options.useGit) {
				cmd += ' --usegit';
			}
			
			if (options.save) {
				cmd += ' --save';
			}
		}
		
		return CordovaProject.wrapVoidAction(cmd, this._path);
	}
	
	checkForUpdates(): Q.Promise<Array<CordovaPlatformInfo>> {
		var result = Q.defer<Array<CordovaPlatformInfo>>();
		
		result.reject('Not yet implemented.');
		
		return result.promise;
	}
	
	private static wrapVoidAction(commandLine: string, workingDirectory?: string): Q.Promise<CordovaActionResult> {
		var result = Q.defer<CordovaActionResult>();
		
		var words = commandLine.split(/\s+/g);
		var command = words.shift();
		
		var spawnOpts = { env: process.env, cwd: process.cwd() };
		if (workingDirectory) {
			spawnOpts.cwd = workingDirectory;
		} 
		
		var child = safeSpawn(command, words, spawnOpts);
		
		child.on('error', function(e) {
			result.reject(e);
		});
		
		var outBuffer = '';
		child.stdout.on('data', function(text) {
			outBuffer += text;
			//console.log(' child> ' + text);
		});
		
		child.on('exit', function(code: number, signal: any) {
			if (code === 0) {
				result.resolve({ output: outBuffer, statusCode: 0 });
			}
			else {
				result.resolve({ output: outBuffer, statusCode: code });
			}
		})
		
		return result.promise;
	}
	
	private static wrapStringAction(commandLine: string, workingDirectory?: string): Q.Promise<string> {
		var result = Q.defer<string>();
		
		var words = commandLine.split(/\s+/g);
		var command = words.shift();
		
		var spawnOpts = { env: process.env, cwd: process.cwd() };
		if (workingDirectory) {
			spawnOpts.cwd = workingDirectory;
		} 
		
		var child = safeSpawn(command, words, spawnOpts);
		
		child.on('error', function(e) {
			result.reject(e);
		});
		
		var outBuffer = '';
		child.stdout.on('data', function(text) {
			outBuffer += text;
			//console.log(' child> ' + text);
		});
		
		child.on('exit', function(e) {
			if (e.code === 0) {
				result.resolve(outBuffer);
			}
			else {
				result.resolve(outBuffer);
			}
		})
		
		return result.promise;
	}
}

exports.CordovaProject = CordovaProject;