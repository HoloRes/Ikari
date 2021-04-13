/* eslint-disable no-console */
const { nanoid } = require('nanoid');
const { exec } = require('child_process');
const os = require('os');
const archiver = require('archiver');
const { createClient } = require('webdav');
const fs = require('fs');

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

async function clipRequest([videoType, videoLink, timestamps, projectName, fileExt, extraArgs]) {
	if (!fs.existsSync('./download')) {
		fs.mkdirSync('./download');
	}
	const internalId = `${videoLink.match(idRegex)[0].substring(3)}_${nanoid()}`;
	let doNotStitch = false;
	let rescaleVideo = false;
	if (extraArgs && extraArgs.length > 0) {
		if (extraArgs[0].value === 'Do Not Stitch Clips' || (extraArgs[1] && extraArgs[1].value === 'Do Not Stitch Clips')) {
			doNotStitch = true;
		}
		if (extraArgs[0].value === 'Rescale Video' || (extraArgs[1] && extraArgs[1].value === 'Rescale Video')) {
			rescaleVideo = true;
		}
	}
	console.log(`(DEBUG) Project File URL: /TL Team/Projects/${projectName}/`);
	console.log(`Recieved Clipping Request ${internalId}, Is Multifile Clip: ${doNotStitch}, Is Rescaled: ${rescaleVideo}`);
	if (await webdavClient.exists(`/TL Team/Projects/${projectName}/`) === false) {
		// TODO: set up project directory with necessary documents via WebDAV
		webdavClient.createDirectory(`/TL Team/Projects/${projectName}/`);
	}
	// This OS check is for development purposes only; will be removed in the future
	if (os.platform() === 'win32') {
		const cmd = `./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "./download/" -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		const res = exec(cmd, { shell: 'powershell.exe' }, async (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return 1;
			}
			if (doNotStitch === true) {
				const zipFile = fs.createWriteStream('./download/clips.zip');
				const archive = archiver('zip', {
					zlib: { level: 9 },
				});

				zipFile.on('close', async () => {
					const stream = fs.createReadStream('./download/clips.zip');
					const result = await webdavClient.putFileContents('/TL Team/Projects/Test/clips.zip', stream);
					if (result === false) {
						return 1;
					}
					fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
						if (err) console.log(err);
					});
					return 0;
				});
				archive.pipe(zipFile);
				archive.directory('./download/', false);
				archive.finalize();
			} else {
				const stream = fs.createReadStream(`./download/${internalId}.${fileExt}`);
				const result = await webdavClient.putFileContents(`/TL Team/Projects/Test/${projectName.replace(/\s+/g, '')}.${fileExt}`, stream);
				if (result === false) {
					return 1;
				}
				fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
					if (err) console.log(err);
				});
			}
			return 0;
		});
		if (res !== 0) return false;
	} else {
		const cmd = `pwsh ./clipper.ps1 -videotype ${videoType} -inlink ${videoLink} -timestampsIn "${timestamps}" -dlDir "./download/" -fulltitle ${internalId} -fileOutExt ${fileExt}`;
		const res = exec(cmd, async (error, stdout) => {
			console.log(stdout);
			console.log(error);
			if (error !== null) {
				console.log(error);
				return 1;
			}
			if (doNotStitch === true) {
				const zipFile = fs.createWriteStream('./download/clips.zip');
				const archive = archiver('zip', {
					zlib: { level: 9 },
				});

				zipFile.on('close', async () => {
					const stream = fs.createReadStream('./download/clips.zip');
					const result = await webdavClient.putFileContents('/TL Team/Projects/Test/clips.zip', stream);
					if (result === false) {
						return 1;
					}
					fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
						if (err) console.log(err);
					});
					return 0;
				});
				archive.pipe(zipFile);
				archive.directory('./download/', false);
				archive.finalize();
			} else {
				const stream = fs.createReadStream(`./download/${internalId}.${fileExt}`);
				const result = await webdavClient.putFileContents(`/TL Team/Projects/Test/${projectName.replace(/\s+/g, '')}.${fileExt}`, stream);
				if (result === false) {
					return 1;
				}
				fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
					if (err) console.log(err);
				});
			}
			return 0;
		});
		if (res !== 0) return false;
	}
	return true;
}
exports.clipRequest = clipRequest;
