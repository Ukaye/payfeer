const fs = require('fs'),
    express = require('express'),
    router = express.Router();

router.post('/document/:id/:name/:folder?', (req, res) => {
    let	id = req.params.id,
        name = req.params.name,
        folder = req.params.folder,
        sampleFile = req.files.file,
        extArray = sampleFile.name.split("."),
        extension = extArray[extArray.length - 1];
    if (extension) extension = extension.toLowerCase();

    if (!name) return res.status(400).send('No files were uploaded.');
    if (!req.files) return res.status(400).send('No files were uploaded.');
    if (!req.params || !id || !name) return res.status(400).send('Required parameter(s) not sent!');

    const file_folder = `files/${folder}/`;
    fs.stat(file_folder, function(err) {
        if (err && (err.code === 'ENOENT'))
            fs.mkdirSync(file_folder);

        const file_url = `${file_folder}${id}_${name}.${extension}`;
        fs.stat(file_url, function (err) {
            if (err) {
                sampleFile.mv(file_url, function(err) {
                    if (err) return res.status(500).send(err);
                    res.send({
                        file:file_url, 
                        data: sampleFile
                    });
                });
            } else {
                fs.unlink(file_url,function(err){
                    if(err){
                        return console.log(err);
                    } else {
                        sampleFile.mv(file_url, function(err) {
                            if (err)
                                return res.status(500).send(err);
                            res.status(200).send({
                                file:file_url, 
                                data: sampleFile
                            });
                        });
                    }
                });
            }
        });
    });
});

module.exports = router;