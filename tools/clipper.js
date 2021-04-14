/* eslint-disable no-console */
const { nanoid } = require('nanoid');
const { spawn } = require('child_process');
const archiver = require('archiver');
const { createClient } = require('webdav');
const fs = require('fs');
const path = require('path');

// Local files
const config = require('../config.json');

const ytIdRegex = /(\?v=|be\/).{11}/g;
const otherIdRegex = /(?<=\.|\/\/)([\w-])+\w+(?=\.)/g;

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
	let internalId = `DEFAULT_NULL_${nanoid()}`;
	if (videoType === 'youtube') {
		internalId = `yt_${videoLink.match(ytIdRegex)[0].substring(3)}_${nanoid()}`;
	} else {
		internalId = `other_${videoLink.match(otherIdRegex)}_${nanoid()}`;
	}
	console.log(`(DEBUG) Internal ID: ${internalId}`);
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
	console.log(`Received Clipping Request ${internalId}, Is Multifile Clip: ${doNotStitch}, Is Rescaled: ${rescaleVideo}`);
	console.log(`(DEBUG) Project File Path: /TL Team/Projects/${projectName}/`);
	if (await webdavClient.exists(`/TL Team/Projects/${projectName}/`) === false) {
		// TODO: set up project directory with necessary documents via WebDAV
		await webdavClient.createDirectory(`/TL Team/Projects/${projectName}/`);
		webdavClient.copyFile('/TL Team/Project template/Meta Template.docx', `/TL Team/Projects/${projectName}/Meta - ${projectName}.docx`);
		webdavClient.copyFile('/TL Team/Project template/QC Template.docx', `/TL Team/Projects/${projectName}/QC - ${projectName}.docx`);
		webdavClient.copyFile('/TL Team/Project template/TL Template.xlsx', `/TL Team/Projects/${projectName}/TL Sheet - ${projectName}.xlsx`);
	}
	const proc = await spawn('pwsh', ['./tools/clipper.ps1', '-videotype', videoType, '-inlink', videoLink, '-timestampsIn', `"${timestamps}"`, '-dlDir', './download/', '-fulltitle', internalId, formatType, fileExt, '-doNotStitch', doNotStitch, '-rescaleVideo', rescaleVideo, '-isIkari', 'true'], {
		cwd: path.join(__dirname, '../'),
	});

	proc.stderr.on('data', (data) => {
		console.error(data.toString());
		if (data.toString().startsWith('At ') || data.toString().startsWith('ERROR:')) reject();
	});

	proc.stdout.on('data', (data) => {
		// TODO: Remove console log
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
				console.log('(DEBUG): Uploading to Nextcloud...');
				const result = await webdavClient.putFileContents(`/TL Team/Projects/${projectName}/clips.zip`, stream);
				fs.unlink('./download/clips.zip', (err) => {
					if (err) console.log(err);
				});
				fs.rmdir('./temp', { recursive: true }, (err) => {
					if (err) console.log(err);
				});
				if (result === false) {
					console.error('(DEBUG): Upload to Nextcloud failed');
					reject();
					return 1;
				}
				console.log('(DEBUG): Upload to Nextcloud succeeded');
				return 0;
			});
			archive.pipe(zipFile);
			archive.directory('./temp/', false);
			// eslint-disable-next-line max-len
			// TODO: Above could break when accidentally having left over files or having simultaneous downloads
			archive.finalize();
		} else {
			const stream = fs.readFileSync(`./download/${internalId}.${fileExt}`);
			console.log('(DEBUG): Uploading to Nextcloud...');
			const result = await webdavClient.putFileContents(`/TL Team/Projects/${projectName}/${projectName.replace(/\s+/g, '')}.${fileExt}`, stream);
			fs.unlink(`./download/${internalId}.${fileExt}`, (err) => {
				if (err) console.log(err);
			});
			if (result === false) {
				console.error('(DEBUG): Upload to Nextcloud failed');
				reject();
				return false;
			}
			console.log('(DEBUG): Upload to Nextcloud succeeded');
		}
		resolve();
		return true;
	});
});
exports.clipRequest = clipRequest;
