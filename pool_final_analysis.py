import math

# Refined outline based on new high-res photos Sep 09
# Z = length, -18 shallow (house/spa) to +16 deep (raised wall)
# X = width, -10 house side (tanning ledge bulge) to +10 fence side

outline = [
    (-3.5, -17.5),   # shallow near spa connection
    (-6.0, -16.0),   # near spa
    (-9.5, -12.0),   # tanning ledge outer leftmost bulge
    (-10.0, -7.0),   # tanning ledge mid
    (-8.5, -2.0),    # transition mid
    (-7.0, 4.0),     # mid-left
    (-5.5, 10.0),    # deep-left
    (-1.0, 15.5),    # deep center-left
    (3.0, 16.5),     # deep center
    (7.0, 15.0),     # deep right
    (9.0, 10.0),     # mid-right
    (9.5, 4.0),      # mid-right
    (8.5, -2.0),     # shallow-right
    (6.5, -8.0),     # shallow-right
    (3.0, -14.0),    # shallow-right near center
    (0.0, -17.0),    # shallow tip
]

def poly_area(pts):
    a=0
    n=len(pts)
    for i in range(n):
        x1,z1=pts[i]
        x2,z2=pts[(i+1)%n]
        a+=x1*z2-x2*z1
    return abs(a)/2

def perimeter(pts):
    p=0
    n=len(pts)
    for i in range(n):
        x1,z1=pts[i]
        x2,z2=pts[(i+1)%n]
        p+=math.hypot(x2-x1,z2-z1)
    return p

def point_in_poly(x,z,poly):
    inside=False
    n=len(poly)
    for i in range(n):
        x1,z1=poly[i]
        x2,z2=poly[(i+1)%n]
        if ((z1>z)!=(z2>z)):
            xinters=(x2-x1)*(z-z1)/(z2-z1+1e-9)+x1
            if x < xinters:
                inside=not inside
    return inside

def depth_at(x,z,deep_end=6.0):
    # tanning ledge: large area on left side
    # if inside tanning ledge circle approx center (-8.5,-9) radius 6
    dx=x+8.5
    dz=z+9
    if dx*dx+dz*dz < 36 and z < -2:  # inside ledge bulge
        # steps at edge
        dist=math.hypot(dx,dz)
        if dist < 3:
            return 0.8
        elif dist < 4.5:
            return 1.0
        elif dist < 5.5:
            return 1.5
        else:
            return 2.2
    if z <= -10:
        return 3.5
    else:
        t=(z+10)/26.5  # -10 to 16.5 = 26.5
        t=max(0,min(1,t))
        return 3.5 + t*(deep_end-3.5)

def integrate(pts, deep_end, res=0.25):
    min_x=min(p[0] for p in pts)
    max_x=max(p[0] for p in pts)
    min_z=min(p[1] for p in pts)
    max_z=max(p[1] for p in pts)
    vol=0
    floor=0
    nx=int((max_x-min_x)/res)+1
    nz=int((max_z-min_z)/res)+1
    cell=res*res
    for i in range(nx):
        x=min_x+i*res+res/2
        for j in range(nz):
            z=min_z+j*res+res/2
            if point_in_poly(x,z,pts):
                d=depth_at(x,z,deep_end)
                vol+=d*cell
                eps=0.2
                d2=depth_at(x,z+eps,deep_end)
                d1=depth_at(x,z-eps,deep_end)
                slope=math.sqrt(1+((d2-d1)/(2*eps))**2)
                floor+=cell*slope
    return vol,floor

def wall_area(pts, deep_end):
    area=0
    n=len(pts)
    for i in range(n):
        x1,z1=pts[i]
        x2,z2=pts[(i+1)%n]
        length=math.hypot(x2-x1,z2-z1)
        mx=(x1+x2)/2
        mz=(z1+z2)/2
        d=depth_at(mx,mz,deep_end)
        area+=d*length
    return area

area=poly_area(outline)
perim=perimeter(outline)
print(f"Main pool surface: {area:.1f} ft²")
print(f"Perimeter: {perim:.1f} ft")

spa_r=3.75
spa_area=math.pi*spa_r**2
print(f"Spa area: {spa_area:.1f} ft²")

for deep in [6.0,6.5,7.0,8.0]:
    vol,floor=integrate(outline, deep, 0.25)
    wall=wall_area(outline, deep)
    spa_vol=spa_area*3.0
    total_vol=vol+spa_vol
    total_interior=floor+wall+spa_area+2*math.pi*spa_r*3.0
    print(f"\nDeep {deep}':")
    print(f"  Main vol {vol:.0f} ft³ = {vol*7.48052:.0f} gal")
    print(f"  Total vol {total_vol:.0f} ft³ = {total_vol*7.48052:.0f} gal = {total_vol*28.3168:.0f} L = {total_vol*0.0283168:.1f} m³")
    print(f"  Floor {floor:.0f} ft², Walls {wall:.0f} ft², Total interior {total_interior:.0f} ft² = {total_interior*0.092903:.1f} m²")
    print(f"  Avg depth {vol/area:.2f} ft")
