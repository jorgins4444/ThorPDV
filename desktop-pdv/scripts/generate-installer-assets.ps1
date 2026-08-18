$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$out = Join-Path $root 'build-assets'
New-Item -ItemType Directory -Path $out -Force | Out-Null

function Paint-Hammer([Drawing.Graphics]$g,[float]$scale,[float]$x,[float]$y) {
  $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $state=$g.Save(); $g.TranslateTransform($x,$y); $g.RotateTransform(-18)
  $gold=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(202,139,44))
  $steel=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(224,235,229))
  $shade=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(154,175,164))
  $g.FillRectangle($gold,46*$scale,67*$scale,20*$scale,90*$scale)
  $g.FillRectangle($steel,12*$scale,34*$scale,90*$scale,42*$scale)
  $g.FillRectangle($shade,8*$scale,27*$scale,24*$scale,55*$scale)
  $g.Restore($state); $gold.Dispose(); $steel.Dispose(); $shade.Dispose()
}

$icon=[Drawing.Bitmap]::new(256,256,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g=[Drawing.Graphics]::FromImage($icon); $g.Clear([Drawing.Color]::Transparent)
$circle=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(15,58,41)); $g.FillEllipse($circle,12,12,232,232)
Paint-Hammer $g 1.45 50 34
$pngPath=Join-Path $out 'thor-hammer.png'; $icon.Save($pngPath,[Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $circle.Dispose(); $icon.Dispose()
$png=[IO.File]::ReadAllBytes($pngPath); $stream=[IO.File]::Create((Join-Path $out 'thor-hammer.ico')); $writer=New-Object IO.BinaryWriter($stream)
$writer.Write([UInt16]0);$writer.Write([UInt16]1);$writer.Write([UInt16]1);$writer.Write([Byte]0);$writer.Write([Byte]0);$writer.Write([Byte]0);$writer.Write([Byte]0)
$writer.Write([UInt16]1);$writer.Write([UInt16]32);$writer.Write([UInt32]$png.Length);$writer.Write([UInt32]22);$writer.Write($png);$writer.Dispose();$stream.Dispose()

$side=[Drawing.Bitmap]::new(164,314,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
$sg=[Drawing.Graphics]::FromImage($side);$rect=New-Object Drawing.Rectangle 0,0,164,314
$bg=New-Object Drawing.Drawing2D.LinearGradientBrush $rect,([Drawing.Color]::FromArgb(8,31,22)),([Drawing.Color]::FromArgb(18,91,59)),90
$sg.FillRectangle($bg,$rect);Paint-Hammer $sg 0.72 34 42
$white=New-Object Drawing.SolidBrush ([Drawing.Color]::White);$mint=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(160,231,195))
$title=New-Object Drawing.Font 'Segoe UI',18,[Drawing.FontStyle]::Bold;$small=New-Object Drawing.Font 'Segoe UI',9
$sg.DrawString('THORPDV',$title,$white,16,198);$sg.DrawString('Instalacao segura',$small,$mint,18,236);$sg.DrawString('por ThorControl',$small,$mint,18,253)
$side.Save((Join-Path $out 'thor-installer-sidebar.bmp'),[Drawing.Imaging.ImageFormat]::Bmp)
$sg.Dispose();$bg.Dispose();$white.Dispose();$mint.Dispose();$title.Dispose();$small.Dispose();$side.Dispose()
Write-Host 'Identidade visual do Martelo do Thor gerada.'
