#May his soul help anyone trying to sift their way through this garbage heap of a script.
param (
    [string]$fulltitle = "output",
    [string]$videotype = $null,
    [string]$hlrwStandards = "n",
    [string]$inlink = $null,
    [string]$miniclip = "y",
    [string]$tempfile = $null,
    [string]$dlDir = ".",
    [string]$timestampsIn = $null,
    [string]$needsstitching = "y",
    [string]$fileOutExt = "mkv"
)
$tempdir = [System.IO.Path]::GetTempPath()
$tempdir = $tempdir.trim("/")
#Add-Type -AssemblyName PresentationCore,PresentationFramework
function parser($clipstamps) {
    $clipTimestamps=$clipstamps.trim("[]")
        $clip1st1,$clip1st2=$clipTimestamps.split("-")
        $c1st1array=$clip1st1.split(":")
        $c1st2array=$clip1st2.split(":")
        $c1a1,$c1a2,$c1a3=$clip1st1.split(":")
        $c1b1,$c1b2,$c1b3=$clip1st2.split(":")
        $c1a1 = [int]$c1a1
        $c1a2 = [int]$c1a2
        $c1a3 = [int]$c1a3
        $c1b1 = [int]$c1b1
        $c1b2 = [int]$c1b2
        $c1b3 = [int]$c1b3
        if ($c1st1array.length -eq 2) {
            if (($c1a1.tostring().length) -eq 1) {
                $c1a1 = "0$c1a1"
            }
            if (($c1a2.tostring().length) -eq 1) {
                $c1a2 = "0$c1a2"
            }
            $tsin = "00`:$c1a1`:$c1a2`:00"
        }
        if ($c1st1array.length -eq 3) {
            if (($c1a1.tostring().length) -eq 1) {
                $c1a1 = "0$c1a1"
            }
            if (($c1a2.tostring().length) -eq 1) {
                $c1a2 = "0$c1a2"
            }
            if (($c1a3.tostring().length) -eq 1) {
                $c1a3 = "0$c1a3"
            }
            $tsin = "$c1a1`:$c1a2`:$c1a3`:00"
        }
        if ($c1st2array.length -eq 2) {
            if (($c1b1.tostring().length) -eq 1) {
                $c1b1 = "0$c1b1"
            }
            if (($c1b2.tostring().length) -eq 1) {
                $c1b2 = "0$c1b2"
            }
            $tein = "00`:$c1b1`:$c1b2`:00"
        }
        if ($c1st2array.length -eq 3) {
            if (($c1b1.tostring().length) -eq 1) {
                $c1b1 = "0$c1b1"
            }
            if (($c1b2.tostring().length) -eq 1) {
                $c1b2 = "0$c1b2"
            }
            if (($c1b3.tostring().length) -eq 1) {
                $c1b3 = "0$c1b3"
            }
            $tein = "$c1b1`:$c1b2`:$c1b3`:00"
        }
    $clipts = $tsin.split(":")
    $clipts1 = [int]$clipts[0] #1ts1
    $clipts2 = [int]$clipts[1] #1ts2
    $clipts3 = [int]$clipts[2] #1ts3
    $clipts4 = [int]$clipts[3] #1ts4
    if ($hlrwStandards -eq "Y" -or $hlrwStandards -eq "y") {
        if ($clipts3 -lt 5 -and $clipts2 -eq 0 -and $clipts1 -eq 0) {
            $clipts3 = 0
        }
        else {
            $clipts3 = $clipts3 - 5
            if ($clipts3 -lt 0) {
                    $clipts3 = $clipts3 + 60
                    $clipts2 = $clipts2 - 1
                    if ($clipts2 -lt 0) {
                        $clipts2 = $clipts2 + 60
                        $clipts1 = $clipts1 - 1
                    }
            }
        }
    }
    $clipte = $tein.split(":")
    $clipte1 = [int]$clipte[0] #1te1
    $clipte2 = [int]$clipte[1] #1te2
    $clipte3 = [int]$clipte[2] #1te3
    $clipte4 = [int]$clipte[3] #1te4
    if ($hlrwStandards -eq "Y" -or $hlrwStandards -eq "y") {
        $clipte3 = $clipte3 + 5
        if ($clipte3 -ge 60) {
            $clipte3 = $clipte3 - 60
            $clipte2 = $clipte2 + 1
            if ($clipte2 -ge 60) {
                $clipte2 = $clipte2 - 60
                $clipte1 = $clipte1 + 1
            }
        }
    }
    $cliptc1 = $clipte1 - $clipts1
    $cliptc2 = $clipte2 - $clipts2
    $cliptc3 = $clipte3 - $clipts3
    $cliptc4 = $clipte4 - $clipts4
    if ($cliptc3 -lt 0) {
        $cliptc3 = $cliptc3 + 60
        $cliptc2 = $cliptc2 - 1
        if ($cliptc2 -lt 0) {
            $cliptc2 = $cliptc2 + 60
            $cliptc1 = $cliptc1 - 1
        }
    }
    if (($cliptc1.tostring().length) -eq 1) {
        $cliptc1 = "0$cliptc1"
    }
    if (($cliptc2.tostring().length) -eq 1) {
        $cliptc2 = "0$cliptc2"
    }
    if (($cliptc3.tostring().length) -eq 1) {
        $cliptc3 = "0$cliptc3"
    }
    if (($cliptc4.tostring().length) -eq 1) {
        $cliptc4 = "0$cliptc4"
    }
    if (($clipts1.tostring().length) -eq 1) {
        $clipts1 = "0$clipts1"
    }
    if (($clipts2.tostring().length) -eq 1) {
        $clipts2 = "0$clipts2"
    }
    if (($clipts3.tostring().length) -eq 1) {
        $clipts3 = "0$clipts3"
    }
    if (($clipts4.tostring().length) -eq 1) {
        $clipts4 = "0$clipts4"
    }
    $clipSps = "$clipts1`:$clipts2`:$clipts3.$clipts4"
    $clipRt = "$cliptc1`:$cliptc2`:$cliptc3.$cliptc4"
    return $clipSps, $clipRt
}
$clipper = {
    $miniclipnum = $timestampsIn.split(",").length
    $parserNum = $timestampsIn.split(",").length
    $clipsSps = @()
    $clipsRt = @()
    $clipnum = 0
    $clipnumout = 1
    $mapperNum = 0
    $ytdlAttempts = 0
    $clipStamps=$timestampsIn.split(",")
    if ($videotype -eq "A" -or $videotype -eq "a") {
        while (!$glinks -and $ytdlAttempts -lt 5) {
            $glinks = youtube-dl -g "$inlink"
            $glinksBACKUP = youtube-dl -g --youtube-skip-dash-manifest "$inlink"
            $ytdlAttempts = $ytdlAttempts + 1
        }
        if ($ytdlAttempts -eq 5) {
            Write-Host "Error Fetching Direct File Links. Verify Inputted Media Link"
            Throw "ERROR: YTDL failed to fetch media links"
        }
        $glink1,$glink2 = $glinks.split(" ")
        $glinkBACK1,$glinkBACK2 = $glinksBACKUP.split(" ")
        if (!$glink2) {$glink2 = $glink1}
        if (!$glinkBACK2) {$glinkBACK2 = $glinkBACK1}
    }
    if ($videotype -eq "B" -or $videotype -eq "b") {
        $glink = youtube-dl -g "$inlink"
        while (!$glink-and $ytdlAttempts -lt 5) {
            $glink = youtube-dl -g "$inlink"
            $ytdlAttempts = $ytdlAttempts + 1
        }
        if ($ytdlAttempts -eq 5) {
            Write-Host "Error Fetching Direct File Links. Verify Inputted Media Link"
            Throw "ERROR: YTDL failed to fetch media links"
        }
    }
    while ($parserNum -gt 0) {
        $parserOut = parser $clipStamps[$clipnum]
        $clipsSps += $parserOut[0]
        $clipsRt += $parserOut[1]
        if ($videotype -eq "A" -or $videotype -eq "a") {
            if ($miniclipnum -eq 1) {
                ffmpeg -y -ss $clipsSps[$clipnum] -i ($glink1) -t $clipsRt[$clipnum] -ss $clipsSps[$clipnum] -i ($glink2) -t $clipsRt[$clipnum] "$dlDir/$fulltitle.$fileOutExt"
                if ((Test-Path("$dlDir/$fulltitle.$fileOutExt")) -eq $true) {
                    Write-Host "Clipping Complete"
                }
                else {
                    ffmpeg -y -ss $clipsSps[$clipnum] -i ($glinkBACK1) -t $clipsRt[$clipnum] -ss $clipsSps[$clipnum] -i ($glinkBACK2) -t $clipsRt[$clipnum] "$dlDir/$fulltitle.$fileOutExt"
                    if ((Test-Path("$dlDir/$fulltitle.$fileOutExt")) -eq $true) {
                        Write-Host "Clipping Complete"
                    }
                    else {
                        Write-Host "Clipping Unsuccessful"
                    }
                }
            }
            if ($miniclipnum -ge 2) {
                ffmpeg -y -ss $clipsSps[$clipnum] -i ($glink1) -t $clipsRt[$clipnum] -ss $clipsSps[$clipnum] -i ($glink2) -t $clipsRt[$clipnum] "$tempdir/clip$clipnumout.mkv"
                if ((Test-Path("$tempdir/clip$clipnumout.mkv")) -eq $true) {
                    $stitchCmdInputs = $stitchCmdInputs + "-i `"$tempdir/clip$clipnumout.mkv`" "
                    $stitchCmdMapInputs = $stitchCmdMapInputs + "[$mapperNum`:v:0][$mapperNum`:a:0]"
                    $stitchCmdMapInputsCount = $stitchCmdMapInputsCount + 1
                    if (($hlrwStandards -eq "Y" -or $hlrwStandards -eq "y") -and ($parsernum -gt 1)) {
                        $mapperNum = $mapperNum + 1
                        $stitchCmdInputs = $stitchCmdInputs + "-i `"$tempdir/blackscreen.mkv`" "
                        $stitchCmdMapInputs = $stitchCmdMapInputs + "[$mapperNum`:v:0][$mapperNum`:a:0]"
                        $stitchCmdMapInputsCount = $stitchCmdMapInputsCount + 1
                    }
                }
                else {
                    ffmpeg -y -ss $clipsSps[$clipnum] -i ($glink1) -t $clipsRt[$clipnum] -ss $clipsSps[$clipnum] -i ($glink2) -t $clipsRt[$clipnum] "$tempdir/clip$clipnumout.mkv"
                    if ((Test-Path("$tempdir/clip$clipnumout.mkv")) -eq $true) {
                        $stitchCmdInputs = $stitchCmdInputs + "-i `"$tempdir/clip$clipnumout.mkv`" "
                        $stitchCmdMapInputs = $stitchCmdMapInputs + "[$mapperNum`:v:0][$mapperNum`:a:0]"
                        $stitchCmdMapInputsCount = $stitchCmdMapInputsCount + 1
                        if (($hlrwStandards -eq "Y" -or $hlrwStandards -eq "y") -and ($parsernum -gt 1)) {
                            $mapperNum = $mapperNum + 1
                            $stitchCmdInputs = $stitchCmdInputs + "-i `"$tempdir/blackscreen.mkv`" "
                            $stitchCmdMapInputs = $stitchCmdMapInputs + "[$mapperNum`:v:0][$mapperNum`:a:0]"
                            $stitchCmdMapInputsCount = $stitchCmdMapInputsCount + 1
                        }
                    }
                    else {
                        Write-Host "Clipping Unsuccessful"
                    }
                }
            }
        }
        if ($videotype -eq "B" -or $videotype -eq "b") {
            if ($miniclipnum -eq 1) {
                ffmpeg -y -ss $clipsSps[$clipnum] -i ($glink) -t $clipsRt[$clipnum] "$dlDir/$fulltitle.$fileOutExt"
                if ((Test-Path("$dlDir/$fulltitle.$fileOutExt")) -eq $true) {
                    Write-Host "Clipping Complete"
                }
                else {
                    Write-Host "Clipping Unsuccessful"
                }
            }
            if ($miniclipnum -ge 2) {
                ffmpeg -y -ss $clipsSps[$clipnum] -i ($glink) -t $clipsRt[$clipnum] "$tempdir/clip$clipnumout.mkv"
                $stitchCmdInputs = $stitchCmdInputs + "-i `"$tempdir/clip$clipnumout.mkv`" "
                $stitchCmdMapInputs = $stitchCmdMapInputs + "[$mapperNum`:v:0][$mapperNum`:a:0]"
                $stitchCmdMapInputsCount = $stitchCmdMapInputsCount + 1
                if (($hlrwStandards -eq "Y" -or $hlrwStandards -eq "y") -and ($parsernum -gt 1)) {
                    $mapperNum = $mapperNum + 1
                    $stitchCmdInputs = $stitchCmdInputs + "-i `"$tempdir/blackscreen.mkv`" "
                    $stitchCmdMapInputs = $stitchCmdMapInputs + "[$mapperNum`:v:0][$mapperNum`:a:0]"
                    $stitchCmdMapInputsCount = $stitchCmdMapInputsCount + 1
                }
            }
        }
        if ($videotype -eq "C" -or $videotype -eq "c") {
            if ($miniclipnum -eq 1) {
                ffmpeg -y -ss $clipsSps[$clipnum] -i ($tempfile) -t $clipsRt[$clipnum] "$dlDir/$fulltitle.$fileOutExt"
                if ((Test-Path("$dlDir/$fulltitle.$fileOutExt")) -eq $true) {
                    Write-Host "Clipping Complete"
                }
                else {
                    Write-Host "Clipping Unsuccessful"
                }
            }
            if ($miniclipnum -ge 2) {
                ffmpeg -y -ss $clipsSps[$clipnum] -i ($tempfile) -t $clipsRt[$clipnum] "$tempdir/clip$clipnumout.mkv"
                $stitchCmdInputs = $stitchCmdInputs + "-i `"$tempdir/clip$clipnumout.mkv`" "
                $stitchCmdMapInputs = $stitchCmdMapInputs + "[$mapperNum`:v:0][$mapperNum`:a:0]"
                $stitchCmdMapInputsCount = $stitchCmdMapInputsCount + 1
                if (($hlrwStandards -eq "Y" -or $hlrwStandards -eq "y") -and ($parsernum -gt 1)) {
                    $mapperNum = $mapperNum + 1
                    $stitchCmdInputs = $stitchCmdInputs + "-i `"$tempdir/blackscreen.mkv`" "
                    $stitchCmdMapInputs = $stitchCmdMapInputs + "[$mapperNum`:v:0][$mapperNum`:a:0]"
                    $stitchCmdMapInputsCount = $stitchCmdMapInputsCount + 1
                }
            }
        }
        $mapperNum ++
        $clipnum ++
        $clipnumout ++
        $parserNum --
    }
    $stitchCmdMapInputs = $stitchCmdMapInputs + "concat=n=$stitchCmdMapInputsCount`:v=1:a=1[outv][outa]"
    $stitchCmd = "ffmpeg -y -hide_banner -loglevel error $stitchCmdInputs -filter_complex `"$stitchCmdMapInputs`" -map `"[outv]`" -map `"[outa]`" -x264-params keyint=24:min-keyint=1 `"$dlDir/$fulltitle.$fileOutExt`""
    if ($needsstitching -eq "Y" -or $needsstitching -eq "y") {
        if ($miniclipnum -ge 2) {
            if ($hlrwStandards -eq "Y" -or $hlrwStandards -eq "y") {
                $clipresolution = ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$tempdir/clip1.mkv"
                ffmpeg -y -f lavfi -i color=black:s="$clipresolution":r=30000/1000 -f lavfi -i anullsrc -ar 48000 -ac 2 -t 3 "$tempdir/blackscreen.mkv"
            }
            Invoke-Expression $stitchCmd
            if ((Test-Path("$dlDir/$fulltitle.$fileOutExt")) -eq $true) {
                Write-Host "Clipping Complete"
            }
            else {
                Write-Host "Clipping Unsuccessful"
            }
            $parsernum = $miniclipnum
            $clipnumout = 1
            if ($hlrwStandards -eq "Y" -or $hlrwStandards -eq "y") {
                remove-item "$tempdir/blackscreen.mkv"  
            }
            while ($parserNum -gt 0) {
                remove-Item -path "$tempdir/clip$clipnumout.mkv"
                $clipnumout ++
                $parserNum --
            }
        }
        else {return}
    }
    else {return}
}
#Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope Process
write-host $inlink
&$clipper