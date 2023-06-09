const fs = require('fs');
const https = require('https');
const io = require('socket.io-client');
const zlib = require('zlib');
const applyCommand = `oc apply -f -`;
const { exec } = require('child_process');
var clientcert;
var clientkey;

const TOKEN = process.env.TOKEN || "";
var DEVICENAME = process.env.DEVICENAME || "edge-device-example";
var deviceid = process.env.DEVICEID || "";
var devicetoken = process.env.DEVICETOKEN || "";
const cacrt = fs.readFileSync('ca.crt', 'utf8');
const socketcrt = fs.readFileSync('socket.crt', 'utf8');
const clientOptions = {
    hostname: 'enroll.rciots.com',
    ca: cacrt,
    port: 443,
    path: '/client-cert',
    method: 'GET',
    headers: {
        "devicename": DEVICENAME,
        "Authorization": TOKEN
    }
  };

if ((fs.existsSync('cert/client.crt')) && (fs.existsSync('cert/client.key'))) {
    clientcert = fs.readFileSync('cert/client.crt');
    clientkey = fs.readFileSync('cert/client.key');
    socketConnect(deviceid, devicetoken);
} else {

    var interval = setInterval(() => {
        const req = https.request(clientOptions, (res) => {
            if ((res.statusCode !== 200) && (res.statusCode !== 202)) {
                console.error(`Failed to get client certificate: ${res.statusCode}`);
                return;
            }
            if (res.statusCode === 202){
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    data = JSON.parse(data);
                    if(data.deviceid != undefined) {
                        clientOptions.headers["deviceid"] = data.deviceid;
                        deviceid = data.deviceid;
                        console.log("deviceid: " + deviceid);
                    }
                    if(data.devicetoken != undefined) {
                        clientOptions.headers["devicetoken"] = data.devicetoken;
                        devicetoken = data.devicetoken;
                        console.log("devicetoken: " + devicetoken);
                    }
                    if ((deviceid != "") && (devicetoken != "") && (deviceid != process.env.DEVICEID ) && (devicetoken != process.env.DEVICETOKEN )) {
                        const ocConfig = exec(`oc patch secret rciots-agent -p '{"stringData": {"DEVICEID": "` + deviceid + `", "DEVICETOKEN": "` + devicetoken + `"}}'`, (error, stdout, stderr) => {
                            if (error) {
                                console.error(`Error executing oc command: ${error.message}`);
                                return;
                            }
                            
                            if (stderr) {
                                console.error(`Command stderr: ${stderr}`);
                            }
                            
                            // Process the command output if needed
                            });
                            
                            // Log any output of the oc process to the console
                            ocConfig.stdout.on('data', (data) => {
                            console.log(data.toString());
                            });
                            
                            ocConfig.stderr.on('data', (data) => {
                            console.error(data.toString());
                            });
                            ocConfig.stdin.end();
                    }
                    
                    
                });
                console.log("Pending to approve device on console");
                return;
            }
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                data = JSON.parse(data);
                if (data.devicetoken !== undefined){
                    if(data.deviceid != undefined) {
                        clientOptions.headers["deviceid"] = data.deviceid;
                        deviceid = data.deviceid;
                    }
                    if(data.devicetoken != undefined) {
                        clientOptions.headers["devicetoken"] = data.devicetoken;
                        devicetoken = data.devicetoken;
                    }
                    if ((deviceid != "") && (devicetoken != "") && (deviceid != process.env.DEVICEID ) && (devicetoken != process.env.DEVICETOKEN )) {
                        exec(`oc patch secret rciots-agent -p '{"stringData": {"DEVICEID": "` + deviceid + `", "DEVICETOKEN": "` + devicetoken + `"}}'`, (error, stdout, stderr) => {
                            if (error) {
                                console.error(`Error executing oc command: ${error.message}`);
                                return;
                            }
                            if (stdout) {
                                console.log(`Command stdout: ${stdout}`);
                            }
                            if (stderr) {
                                console.error(`Command stderr: ${stderr}`);
                            }
                            
                            // Process the command output if needed
                        });
                    }
                }
                clientcert = data.cert;
                clientkey = data.key;
                
                fs.writeFileSync('/tmp/client.crt', clientcert, (err) => {
                    if (err) throw err;
                    });
                fs.writeFileSync('/tmp/client.key', clientkey, (err) => {
                    if (err) throw err;
                });
                exec(`oc create secret generic rciots-agent-certs --from-file=/tmp/client.crt --from-file=/tmp/client.key --dry-run=client -o yaml | oc apply -f -`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`Error executing oc command: ${error.message}`);
                        return;
                    }
                    
                    if (stderr) {
                        console.error(`Command stderr: ${stderr}`);
                    }
                    if (stdout) {
                        console.log(`Command stdout: ${stdout}`);
                    }
                    clearInterval(interval);
                    socketConnect(deviceid, devicetoken);
                });

            });
            res.on('error', err => {
                console.error(`Failed to get client certificate: ${err}`);
            });
        });
        req.end();
    
    }, 10000);


}

function socketConnect(devid, devtoken) {
    var certpath = "cert/client.crt";
    var keypath = "cert/client.key";
    if (fs.existsSync("/tmp/client.key")) {
        certpath = "/tmp/client.crt";
        keypath = "/tmp/client.key";
    }
    socket = new io.connect('https://edge.rciots.com', {
        key: fs.readFileSync(keypath, 'utf-8'),
        cert: fs.readFileSync(certpath, 'utf-8'),
        ca: socketcrt,
        rejectUnauthorized: true,
        auth: {deviceid: devid,
            devicetoken: devtoken
        }
    });
    socket.on("connect_error", (err) => {
        console.log(`error!!! ${err}`);
        console.log(`${err.message}`);
    });
    socket.on('connect', () => {
        console.log('Connected to socket.io server');
        socket.on('manifest', (data) => {
            console.log("manifest received.");
            const compressedData = Buffer.from(data, 'base64');
            zlib.unzip(compressedData, (error, uncompressedData) => {
                if (error) {
                    console.error('Error uncompressing data:', error);
                    return;
                }
                
                // The uncompressed data as a string
                const decodedData = uncompressedData.toString();
                console.log(decodedData);
                
                const ocProcess = exec(applyCommand, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`Error executing oc command: ${error.message}`);
                        return;
                    }
                    
                    if (stderr) {
                        console.error(`Command stderr: ${stderr}`);
                    }
    
                    });
                    
                    // Log any output of the oc process to the console
                    ocProcess.stdout.on('data', (data) => {
                    console.log(data.toString());
                    });
                    
                    ocProcess.stderr.on('data', (data) => {
                    console.error(data.toString());
                    });
                ocProcess.stdin.write(decodedData);
                ocProcess.stdin.end();
            });
        });
        socket.on('disconnect', () => {
            console.log('Disconnected from socket.io server');
        });
    });
    
}