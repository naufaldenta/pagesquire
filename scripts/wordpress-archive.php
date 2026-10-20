<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}
[$script, $mode, $source, $destination] = $argv;
if ($mode === 'extract') {
    $zip = new ZipArchive;
    if ($zip->open($source) !== true) {
        throw new RuntimeException('Cannot open the fixture archive.');
    }
    for ($index = 0; $index < $zip->numFiles; $index++) {
        $name = str_replace('\\', '/', $zip->getNameIndex($index));
        if (str_starts_with($name, '/') || preg_match('~(?:^|/)\.\.(?:/|$)|^[A-Za-z]:~', $name)) {
            throw new RuntimeException('Unsafe archive path.');
        }
        $zip->getExternalAttributesIndex($index, $system, $attributes);
        if ($system === ZipArchive::OPSYS_UNIX && (($attributes >> 16) & 0170000) === 0120000) {
            throw new RuntimeException('Do not extract symbolic links.');
        }
    }
    $zip->extractTo($destination);
    $zip->close();
} elseif ($mode === 'zip') {
    $zip = new ZipArchive;
    if ($zip->open($destination, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        throw new RuntimeException('Cannot create the plugin archive.');
    }
    $source = realpath($source);
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS));
    $files = [];
    foreach ($iterator as $file) {
        if ($file->isLink()) {
            throw new RuntimeException('Do not package symbolic links.');
        }
        if ($file->isFile()) {
            $files[] = $file->getPathname();
        }
    }
    sort($files, SORT_STRING);
    foreach ($files as $file) {
        $name = 'pagesquire/'.str_replace('\\', '/', substr($file, strlen($source) + 1));
        $zip->addFile($file, $name);
        $zip->setMtimeName($name, 1735689600);
        $zip->setExternalAttributesName($name, ZipArchive::OPSYS_UNIX, 0100644 << 16);
    }
    $zip->close();
} else {
    throw new RuntimeException('Unknown archive operation.');
}
