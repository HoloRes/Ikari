/* eslint-disable no-console */
const { nanoid } = require('nanoid');
const { spawn } = require('child_process');
const archiver = require('archiver');
const { createClient } = require('webdav');
const fs = require('fs');
const path = require('path');

// Local files
const config = require('../config.json');

const idRegex = /(\?v=|be\/).{11}/g;

const webdavClient = createClient(
	config.webdav.url,
	{
		username: config.webdav.username,
		password: config.webdav.password,
		maxBodyLength: 100000000,
		maxContentLength: 100000000,
	},
);

// eslint-disable-next-line consistent-return
const clipRequest = ([
	videoType,
	videoLink,
	timestamps,
	projectName,
	fileExt,
	extraArgs,
// eslint-disable-next-line no-async-promise-executor
]) => new Promise(async (resolve, reject) => {
	if (!fs.existsSync('./download')) {
		fs.mkdirSync('./download');
	}
	const internalId = `${videoLink.match(idRegex)[0].substring(3)}_${nanoid()}`;
	let doNotStitch = 'false';
	let rescaleVideo = 'false';
	let formatType = '-fileOutExt';
	if (extraArgs && extraArgs.length > 0) {
		if (extraArgs[0].value === 'Do Not Stitch Clips' || (extraArgs[1] && extraArgs[1].value === 'Do Not Stitch Clips')) {
			doNotStitch = 'true';
			formatType = '-miniclipFileExt';
		}
		if (extraArgs[0].value === 'Rescale Video' || (extraArgs[1] && extraArgs[1].value === 'Rescale Video')) {
			rescaleVideo = 'true';
		}
	}
	console.log(`(DEBUG) Project File URL: /TL Team/Projects/${projectName}/`);
	console.log(`Recieved Clipping Request ${internalId}, Is Multifile Clip: ${doNotStitch}, Is Rescaled: ${rescaleVideo}`);
	if (await webdavClient.exists(`/TL Team/Projects/${projectName}/`) === false) {
		// TODO: set up project directory with necessary documents via WebDAV
		webdavClient.createDirectory(`/TL Team/Projects/${projectName}/`);
	}
	const proc = await spawn('pwsh', ['./tools/clipper.ps1', '-videotype', videoType, '-inlink', videoLink, '-timestampsIn', timestamps, '-dlDir', './download/', '-fulltitle', internalId, formatType, fileExt, '-doNotStitch', doNotStitch, '-rescaleVideo', rescaleVideo, '-isIkari', 'true'], {
		cwd: path.join(__dirname, '../'),
	});

	proc.stderr.on('data', (data) => {
		console.error(data.toString());
	});

	proc.stdout.on('data', (data) => {
		console.log(data.toString());
		if (data.toString() === 'Clipping Failed') reject();
	});

	proc.on('exit', async (code) => {
		if (code === 1) return false;
		if (doNotStitch === 'true') {
			const zipFile = fs.createWriteStream('./download/clips.zip');
			const archive = archiver('zip', {
				zlib: { level: 9 },
			});

			zipFile.on('close', async () => {
				const stream = fs.readFileSync('./download/clips.zip');
				const result = await webdavClient.putFileContents(`/TL Team/Projects/${projectName}/clips.zip`, stream);
				fs.unlink('./download/clips.zip', (err) => {
					if (err) console.log(err);
				});
				fs.rmdir('./temp', { recursive: true }, (err) => {
					if (err) console.log(err);
				});
				// TODO: Remove all clips
				if (result === false) {
					reject();
					return 1;
				}
				return 0;
			});
			archive.pipe(zipFile);
			archive.directory('./temp/', false);
			// eslint-disable-next-line max-len
			// TODO: Above could break when accidentally having left over files or having simultaneous downloads
			archive.finalize();
		} else {
			const stream = fs.readFileSync(`./download/${internalId}.${fileExt}`);
			const result = await webdavClient.putFileContents(`/TL Team/Projects/${projectName}/${projectName.replace(/\s+/g, '')}.${fileExt}`, stream);
			fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
				if (err) console.log(err);
			});
			if (result === false) {
				reject();
				return false;
			}
		}
		resolve();
		return true;
	});
});
exports.clipRequest = clipRequest;
